// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {VendorSig} from "haven-pq-kit/VendorSig.sol";

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title PayGate
/// @notice Holds the owner's fUSD and pays only vendor-signed invoices.
///
/// The one rule: even if the agent is fully prompt-injected, the only payment that can happen is an invoice
/// signed with the vendor's ML-DSA-87 key (checked on chain through pqcVerify), to the payout address the owner
/// registered for that vendor, once, within the caps. Anything larger waits for the owner's ML-DSA signature.
///
/// The agent's key is linked to the agent account under a spending rule whose only allowed EVM call is
/// `PayGate.pay` / `PayGate.queue`. The token is never listed in that rule, and the funds sit here, not in the
/// account the agent acts for.
contract PayGate {
    using PqAuth for PqAuth.Signer;

    // ---------------------------------------------------------------- types

    /// @dev Timelocked owner operations. The order is part of the signed bytes: append only.
    enum Op {
        AddVendor, //    (address vendor, address payout, uint256 perInvoiceCap)
        SetPayout, //    (address vendor, address payout)          voids the vendor's queued invoices
        SetVendorCap, // (address vendor, uint256 perInvoiceCap)
        SetDailyCap, //  (uint256 dailyCap)
        SetAgent, //     (address agent, uint256 agentUntil)
        Revoke, //       (address vendor)                          voids the vendor's queued invoices
        Withdraw //      (uint256 amount)                          always to the owner account
    }

    enum InvoiceState {
        None,
        Queued,
        Paid
    }

    struct Vendor {
        bool active;
        address payout;
        uint256 perInvoiceCap;
        /// @dev Bumped on every payout change and revocation. A queued invoice from an older epoch is void.
        uint64 epoch;
    }

    struct QueuedInvoice {
        address payee;
        uint256 amount;
        uint64 epoch;
        uint64 queuedAt;
    }

    // ---------------------------------------------------------------- constants

    bytes32 public constant ACTION_PROPOSE = keccak256("steward.PayGate.v1.propose");
    bytes32 public constant ACTION_CANCEL = keccak256("steward.PayGate.v1.cancel");
    bytes32 public constant ACTION_APPROVE = keccak256("steward.PayGate.v1.approveQueued");
    bytes32 public constant ACTION_PAUSE = keccak256("steward.PayGate.v1.pause");
    bytes32 public constant ACTION_UNPAUSE = keccak256("steward.PayGate.v1.unpause");

    /// @notice The longest an owner signature may stay usable.
    uint256 public constant OWNER_AUTH_TTL = 1 days;
    uint256 public constant MIN_DELAY = 1 minutes;
    uint256 public constant MAX_DELAY = 30 days;
    /// @notice A proposal not executed within this long after its eta can no longer be executed.
    uint256 public constant EXECUTION_GRACE = 7 days;

    // ---------------------------------------------------------------- state

    address public immutable token;
    uint256 public immutable timelockDelay;

    PqAuth.Signer internal _owner;

    address public agent;
    uint256 public agentUntil;
    uint256 public dailyCap;
    bool public paused;

    mapping(address vendor => Vendor) public vendors;
    mapping(uint256 day => uint256 spent) public spentOnDay;
    mapping(bytes32 key => InvoiceState) public invoiceState;
    mapping(bytes32 key => QueuedInvoice) public queued;
    mapping(bytes32 opHash => uint256 eta) public pendingEta;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------- events

    event InvoicePaid(
        address indexed vendor, bytes32 indexed invoiceId, address payee, uint256 amount, bool approvedByOwner
    );
    event InvoiceQueued(address indexed vendor, bytes32 indexed invoiceId, address payee, uint256 amount, uint64 epoch);
    event OpProposed(bytes32 indexed opHash, Op kind, bytes params, uint256 eta);
    event OpExecuted(bytes32 indexed opHash, Op kind, bytes params);
    event OpCancelled(bytes32 indexed opHash);
    event VendorChanged(address indexed vendor, bool active, address payout, uint256 perInvoiceCap, uint64 epoch);
    event DailyCapChanged(uint256 dailyCap);
    event AgentChanged(address indexed agent, uint256 agentUntil);
    event Withdrawn(address indexed to, uint256 amount);
    event Paused();
    event Unpaused();

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error BadDelay(uint256 delay);
    error IsPaused();
    error NotPaused();
    error NotAgent(address caller);
    error AgentExpired(uint256 agentUntil);
    error WrongToken(address token);
    error ZeroAmount();
    error UnknownVendor(address vendor);
    error VendorAlreadyActive(address vendor);
    error WrongPayee(address payee, address payout);
    error BadPayout(address payout);
    error InvoiceUsed(address vendor, bytes32 invoiceId, InvoiceState state);
    error OverInvoiceCap(uint256 amount, uint256 cap);
    error OverDailyCap(uint256 spentToday, uint256 amount, uint256 cap);
    error NotQueued(address vendor, bytes32 invoiceId);
    error QueuedVoided(address vendor, bytes32 invoiceId);
    error AlreadyPending(bytes32 opHash);
    error NotPendingOp(bytes32 opHash);
    error TooEarly(uint256 eta);
    error OpStale(uint256 eta);
    error InsufficientFunds(uint256 balance, uint256 amount);
    error TransferFailed();
    error Reentrancy();

    // ---------------------------------------------------------------- modifiers

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    modifier onlyLiveAgent() {
        if (msg.sender != agent) revert NotAgent(msg.sender);
        if (block.timestamp > agentUntil) revert AgentExpired(agentUntil);
        _;
    }

    // ---------------------------------------------------------------- constructor

    /// @param owner_ An account with a registered ML-DSA-87 key and proven possession. Checked here.
    constructor(
        address owner_,
        address token_,
        uint256 timelockDelay_,
        address agent_,
        uint256 agentUntil_,
        uint256 dailyCap_
    ) {
        if (token_ == address(0)) revert ZeroAddress();
        if (timelockDelay_ < MIN_DELAY || timelockDelay_ > MAX_DELAY) revert BadDelay(timelockDelay_);
        _owner.init(owner_);
        token = token_;
        timelockDelay = timelockDelay_;
        agent = agent_;
        agentUntil = agentUntil_;
        dailyCap = dailyCap_;
        emit AgentChanged(agent_, agentUntil_);
        emit DailyCapChanged(dailyCap_);
    }

    // ---------------------------------------------------------------- the agent's two calls

    /// @notice Pay a vendor-signed invoice within the caps. Callable only by the live agent account.
    function pay(VendorSig.Invoice calldata invoice, bytes calldata vendorSig)
        external
        nonReentrant
        whenNotPaused
        onlyLiveAgent
    {
        bytes32 key = _checkInvoice(invoice, vendorSig);
        uint256 cap = vendors[invoice.vendor].perInvoiceCap;
        if (invoice.amount > cap) revert OverInvoiceCap(invoice.amount, cap);
        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOnDay[day];
        if (spent + invoice.amount > dailyCap) revert OverDailyCap(spent, invoice.amount, dailyCap);

        invoiceState[key] = InvoiceState.Paid;
        spentOnDay[day] = spent + invoice.amount;
        emit InvoicePaid(invoice.vendor, invoice.invoiceId, invoice.payee, invoice.amount, false);
        _transfer(invoice.payee, invoice.amount);
    }

    /// @notice Park a vendor-signed invoice for the owner. Same checks as `pay`, except the caps.
    function queue(VendorSig.Invoice calldata invoice, bytes calldata vendorSig)
        external
        nonReentrant
        whenNotPaused
        onlyLiveAgent
    {
        bytes32 key = _checkInvoice(invoice, vendorSig);
        uint64 epoch = vendors[invoice.vendor].epoch;
        invoiceState[key] = InvoiceState.Queued;
        queued[key] = QueuedInvoice({
            payee: invoice.payee,
            amount: invoice.amount,
            epoch: epoch,
            queuedAt: uint64(block.timestamp)
        });
        emit InvoiceQueued(invoice.vendor, invoice.invoiceId, invoice.payee, invoice.amount, epoch);
    }

    // ---------------------------------------------------------------- the owner's immediate calls

    /// @notice Release a queued invoice with the owner's ML-DSA-87 signature. Caps do not apply; pause does not
    /// block it. Void if the vendor was revoked or its payout changed after the invoice was queued.
    function approveQueued(address vendor, bytes32 invoiceId, uint256 deadline, bytes calldata ownerSig)
        external
        nonReentrant
    {
        bytes32 key = invoiceKey(vendor, invoiceId);
        if (invoiceState[key] != InvoiceState.Queued) revert NotQueued(vendor, invoiceId);
        QueuedInvoice memory q = queued[key];
        Vendor storage v = vendors[vendor];
        if (!v.active || v.epoch != q.epoch) revert QueuedVoided(vendor, invoiceId);

        _owner.authorize(ACTION_APPROVE, approveArgsHash(vendor, invoiceId, q.payee, q.amount), deadline, OWNER_AUTH_TTL, ownerSig);

        invoiceState[key] = InvoiceState.Paid;
        delete queued[key];
        emit InvoicePaid(vendor, invoiceId, q.payee, q.amount, true);
        _transfer(q.payee, q.amount);
    }

    function pause(uint256 deadline, bytes calldata ownerSig) external {
        if (paused) revert IsPaused();
        _owner.authorize(ACTION_PAUSE, bytes32(0), deadline, OWNER_AUTH_TTL, ownerSig);
        paused = true;
        emit Paused();
    }

    function unpause(uint256 deadline, bytes calldata ownerSig) external {
        if (!paused) revert NotPaused();
        _owner.authorize(ACTION_UNPAUSE, bytes32(0), deadline, OWNER_AUTH_TTL, ownerSig);
        paused = false;
        emit Unpaused();
    }

    // ---------------------------------------------------------------- the owner's timelocked calls

    function propose(Op kind, bytes calldata params, uint256 deadline, bytes calldata ownerSig) external {
        _check(kind, params, false);
        bytes32 opHash = opHashOf(kind, params);
        if (pendingEta[opHash] != 0) revert AlreadyPending(opHash);
        _owner.authorize(ACTION_PROPOSE, opHash, deadline, OWNER_AUTH_TTL, ownerSig);
        uint256 eta = block.timestamp + timelockDelay;
        pendingEta[opHash] = eta;
        emit OpProposed(opHash, kind, params, eta);
    }

    /// @notice Anyone may execute a proposal once its delay has passed. The owner already signed it.
    function execute(Op kind, bytes calldata params) external nonReentrant {
        bytes32 opHash = opHashOf(kind, params);
        uint256 eta = pendingEta[opHash];
        if (eta == 0) revert NotPendingOp(opHash);
        if (block.timestamp < eta) revert TooEarly(eta);
        if (block.timestamp > eta + EXECUTION_GRACE) revert OpStale(eta);
        delete pendingEta[opHash];
        emit OpExecuted(opHash, kind, params);
        _check(kind, params, true);
    }

    function cancel(bytes32 opHash, uint256 deadline, bytes calldata ownerSig) external {
        if (pendingEta[opHash] == 0) revert NotPendingOp(opHash);
        _owner.authorize(ACTION_CANCEL, opHash, deadline, OWNER_AUTH_TTL, ownerSig);
        delete pendingEta[opHash];
        emit OpCancelled(opHash);
    }

    // ---------------------------------------------------------------- views

    function owner() external view returns (address) {
        return _owner.account;
    }

    function ownerNonce() external view returns (uint256) {
        return _owner.nonce;
    }

    function today() external view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function spentToday() external view returns (uint256) {
        return spentOnDay[block.timestamp / 1 days];
    }

    function invoiceKey(address vendor, bytes32 invoiceId) public pure returns (bytes32) {
        return keccak256(abi.encode(vendor, invoiceId));
    }

    function opHashOf(Op kind, bytes calldata params) public pure returns (bytes32) {
        return keccak256(abi.encode(uint8(kind), params));
    }

    function approveArgsHash(address vendor, bytes32 invoiceId, address payee, uint256 amount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(vendor, invoiceId, payee, amount));
    }

    /// @notice The exact bytes a vendor signs for this gate on this chain.
    function invoiceMessage(VendorSig.Invoice calldata invoice) external view returns (bytes memory) {
        return VendorSig.encode(block.chainid, address(this), invoice);
    }

    /// @notice The exact bytes the owner signs next for `action` (it uses the current nonce).
    function ownerMessage(bytes32 action, bytes32 argsHash, uint256 deadline) external view returns (bytes memory) {
        return PqAuth.encodeMessage(
            block.chainid, address(this), _owner.account, action, _owner.nonce, deadline, argsHash
        );
    }

    // ---------------------------------------------------------------- internals

    /// @dev Every check `pay` and `queue` share. The signature is checked last, after the cheap refusals.
    function _checkInvoice(VendorSig.Invoice calldata invoice, bytes calldata vendorSig)
        private
        view
        returns (bytes32 key)
    {
        if (invoice.token != token) revert WrongToken(invoice.token);
        if (invoice.amount == 0) revert ZeroAmount();
        Vendor storage v = vendors[invoice.vendor];
        if (!v.active) revert UnknownVendor(invoice.vendor);
        if (invoice.payee != v.payout) revert WrongPayee(invoice.payee, v.payout);
        key = invoiceKey(invoice.vendor, invoice.invoiceId);
        InvoiceState state = invoiceState[key];
        if (state != InvoiceState.None) revert InvoiceUsed(invoice.vendor, invoice.invoiceId, state);
        // The vendor's key is read live from pqcKeyStatus: a rotated or removed key stops old invoices.
        VendorSig.verify(invoice, vendorSig);
    }

    /// @dev Validates `params` for `kind`. Applies it when `apply_` is true. Run at propose and again at execute.
    function _check(Op kind, bytes calldata params, bool apply_) private {
        if (kind == Op.AddVendor) {
            (address vendor, address payout, uint256 cap) = abi.decode(params, (address, address, uint256));
            if (vendor == address(0)) revert ZeroAddress();
            _checkPayout(payout);
            Vendor storage v = vendors[vendor];
            if (v.active) revert VendorAlreadyActive(vendor);
            PqAuth._loadKey(vendor); // must hold a registered, proven ML-DSA-87 key now
            if (apply_) {
                v.active = true;
                v.payout = payout;
                v.perInvoiceCap = cap;
                v.epoch += 1;
                emit VendorChanged(vendor, true, payout, cap, v.epoch);
            }
        } else if (kind == Op.SetPayout) {
            (address vendor, address payout) = abi.decode(params, (address, address));
            _checkPayout(payout);
            Vendor storage v = _active(vendor);
            if (apply_) {
                v.payout = payout;
                v.epoch += 1;
                emit VendorChanged(vendor, true, payout, v.perInvoiceCap, v.epoch);
            }
        } else if (kind == Op.SetVendorCap) {
            (address vendor, uint256 cap) = abi.decode(params, (address, uint256));
            Vendor storage v = _active(vendor);
            if (apply_) {
                v.perInvoiceCap = cap;
                emit VendorChanged(vendor, true, v.payout, cap, v.epoch);
            }
        } else if (kind == Op.SetDailyCap) {
            uint256 cap = abi.decode(params, (uint256));
            if (apply_) {
                dailyCap = cap;
                emit DailyCapChanged(cap);
            }
        } else if (kind == Op.SetAgent) {
            (address agent_, uint256 until) = abi.decode(params, (address, uint256));
            if (apply_) {
                agent = agent_;
                agentUntil = until;
                emit AgentChanged(agent_, until);
            }
        } else if (kind == Op.Revoke) {
            address vendor = abi.decode(params, (address));
            Vendor storage v = _active(vendor);
            if (apply_) {
                v.active = false;
                v.epoch += 1;
                emit VendorChanged(vendor, false, v.payout, v.perInvoiceCap, v.epoch);
            }
        } else {
            // Op.Withdraw. An out-of-range enum value never reaches here: abi decoding of `kind` reverts first.
            uint256 amount = abi.decode(params, (uint256));
            if (amount == 0) revert ZeroAmount();
            if (apply_) {
                address to = _owner.account;
                emit Withdrawn(to, amount);
                _transfer(to, amount);
            }
        }
    }

    function _active(address vendor) private view returns (Vendor storage v) {
        v = vendors[vendor];
        if (!v.active) revert UnknownVendor(vendor);
    }

    function _checkPayout(address payout) private view {
        if (payout == address(0) || payout == address(this) || payout == token) revert BadPayout(payout);
    }

    /// @dev Fails closed: the gate's balance must fall by exactly `amount`, whatever the token returns.
    function _transfer(address to, uint256 amount) private {
        uint256 before = IERC20Minimal(token).balanceOf(address(this));
        if (before < amount) revert InsufficientFunds(before, amount);
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
        if (!ok) revert TransferFailed();
        if (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool)))) revert TransferFailed();
        // Strict on purpose: a token that moves more or less than asked is refused.
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (IERC20Minimal(token).balanceOf(address(this)) != before - amount) revert TransferFailed();
    }
}
