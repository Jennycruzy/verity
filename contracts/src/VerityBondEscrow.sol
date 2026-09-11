// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VerityBondEscrow {
    error AlreadyResolved(bytes32 disputeId);
    error BondAlreadyPosted(bytes32 disputeId);
    error BondNotFound(bytes32 disputeId);
    error DirectTransferDisabled();
    error InsufficientAvailableStake(bytes32 providerRoot, uint256 requested, uint256 available);
    error InvalidAmount();
    error InvalidRoot();
    error NotOperator();
    error NotStakeOwner(bytes32 providerRoot);
    error Reentrancy();
    error StakeOwnerAlreadySet(bytes32 providerRoot);
    error TransferFailed(address recipient, uint256 amount);

    struct Bond {
        address buyer;
        uint256 amount;
        bytes32 providerRoot;
        bool resolved;
    }

    struct Reputation {
        uint64 providerCorrect;
        uint64 providerIncorrect;
        uint64 buyerHonest;
        uint64 buyerDishonest;
    }

    address public immutable operator;
    uint256 public immutable minimumBond;

    mapping(bytes32 => Bond) public bonds;
    mapping(bytes32 => uint256) public providerStake;
    mapping(bytes32 => uint256) public lockedStake;
    mapping(bytes32 => address) public stakeOwner;
    mapping(bytes32 => Reputation) public reputation;
    mapping(bytes32 => uint64) public buyerHonest;
    mapping(bytes32 => uint64) public buyerDishonest;

    uint256 private _entered;

    event AgentRegistered(bytes32 indexed agentId, bytes32 indexed humanRoot, bytes32 endpointHash);
    event BondPosted(bytes32 indexed disputeId, address indexed buyer, bytes32 indexed providerRoot, uint256 amount);
    event BondResolved(bytes32 indexed disputeId, bool providerWasWrong, uint256 bondAmount, uint256 slashedStake);
    event ReputationAnchored(bytes32 indexed providerRoot, bytes32 indexed buyerRoot, bool providerWasCorrect, bool buyerWasHonest);
    event StakeDeposited(bytes32 indexed providerRoot, address indexed owner, uint256 amount);
    event StakeWithdrawn(bytes32 indexed providerRoot, address indexed owner, uint256 amount);
    event StakeLocked(bytes32 indexed disputeId, bytes32 indexed providerRoot, uint256 amount);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(uint256 minimumBond_) {
        if (minimumBond_ == 0) revert InvalidAmount();
        operator = msg.sender;
        minimumBond = minimumBond_;
    }

    function registerAgent(bytes32 agentId, bytes32 humanRoot, bytes32 endpointHash) external onlyOperator {
        if (agentId == bytes32(0) || humanRoot == bytes32(0) || endpointHash == bytes32(0)) revert InvalidRoot();
        emit AgentRegistered(agentId, humanRoot, endpointHash);
    }

    function postBond(bytes32 disputeId, bytes32 providerRoot) external payable {
        if (disputeId == bytes32(0) || providerRoot == bytes32(0)) revert InvalidRoot();
        if (msg.value < minimumBond) revert InvalidAmount();
        if (bonds[disputeId].amount != 0) revert BondAlreadyPosted(disputeId);
        bonds[disputeId] = Bond({ buyer: msg.sender, amount: msg.value, providerRoot: providerRoot, resolved: false });
        emit BondPosted(disputeId, msg.sender, providerRoot, msg.value);
    }

    function stakeProvider(bytes32 providerRoot) external payable {
        if (providerRoot == bytes32(0) || msg.value == 0) revert InvalidAmount();
        address owner = stakeOwner[providerRoot];
        if (owner == address(0)) {
            stakeOwner[providerRoot] = msg.sender;
        } else if (owner != msg.sender) {
            revert StakeOwnerAlreadySet(providerRoot);
        }
        providerStake[providerRoot] += msg.value;
        emit StakeDeposited(providerRoot, msg.sender, msg.value);
    }

    function withdrawStake(bytes32 providerRoot, uint256 amount) external nonReentrant {
        if (stakeOwner[providerRoot] != msg.sender) revert NotStakeOwner(providerRoot);
        if (amount == 0) revert InvalidAmount();
        uint256 available = providerStake[providerRoot] - lockedStake[providerRoot];
        if (amount > available) revert InsufficientAvailableStake(providerRoot, amount, available);
        providerStake[providerRoot] -= amount;
        _send(payable(msg.sender), amount);
        emit StakeWithdrawn(providerRoot, msg.sender, amount);
    }

    function lockStake(bytes32 disputeId, uint256 amount) external onlyOperator {
        Bond memory bond = bonds[disputeId];
        if (bond.amount == 0) revert BondNotFound(disputeId);
        if (bond.resolved) revert AlreadyResolved(disputeId);
        uint256 available = providerStake[bond.providerRoot] - lockedStake[bond.providerRoot];
        if (amount > available) revert InsufficientAvailableStake(bond.providerRoot, amount, available);
        lockedStake[disputeId] = amount;
        emit StakeLocked(disputeId, bond.providerRoot, amount);
    }

    function resolveBond(bytes32 disputeId, bool providerWasWrong, address payable buyer, address payable provider) external onlyOperator nonReentrant {
        Bond storage bond = bonds[disputeId];
        if (bond.amount == 0) revert BondNotFound(disputeId);
        if (bond.resolved) revert AlreadyResolved(disputeId);
        bond.resolved = true;

        uint256 slashedStake = lockedStake[disputeId];
        lockedStake[disputeId] = 0;
        if (providerWasWrong) {
            providerStake[bond.providerRoot] -= slashedStake;
            _send(buyer, bond.amount + slashedStake);
        } else {
            _send(provider, bond.amount);
        }
        emit BondResolved(disputeId, providerWasWrong, bond.amount, providerWasWrong ? slashedStake : 0);
    }

    function anchorReputation(bytes32 providerRoot, bytes32 buyerRoot, bool providerWasCorrect, bool buyerWasHonest) external onlyOperator {
        if (providerRoot == bytes32(0) || buyerRoot == bytes32(0)) revert InvalidRoot();
        Reputation storage score = reputation[providerRoot];
        if (providerWasCorrect) score.providerCorrect += 1;
        else score.providerIncorrect += 1;
        if (buyerWasHonest) {
            score.buyerHonest += 1;
            buyerHonest[buyerRoot] += 1;
        } else {
            score.buyerDishonest += 1;
            buyerDishonest[buyerRoot] += 1;
        }
        emit ReputationAnchored(providerRoot, buyerRoot, providerWasCorrect, buyerWasHonest);
    }

    receive() external payable {
        revert DirectTransferDisabled();
    }

    fallback() external payable {
        revert DirectTransferDisabled();
    }

    function _send(address payable recipient, uint256 amount) private {
        (bool success,) = recipient.call{ value: amount }("");
        if (!success) revert TransferFailed(recipient, amount);
    }
}
