// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { VerityBondEscrow } from "../src/VerityBondEscrow.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
}

contract Actor {
    receive() external payable {}

    function postBond(address payable escrow, bytes32 disputeId, bytes32 providerRoot) external payable {
        VerityBondEscrow(escrow).postBond{ value: msg.value }(disputeId, providerRoot);
    }

    function stake(address payable escrow, bytes32 providerRoot) external payable {
        VerityBondEscrow(escrow).stakeProvider{ value: msg.value }(providerRoot);
    }

    function withdraw(address payable escrow, bytes32 providerRoot, uint256 amount) external {
        VerityBondEscrow(escrow).withdrawStake(providerRoot, amount);
    }
}

contract VerityBondEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant BOND = 1 ether;
    bytes32 private constant DISPUTE = keccak256("dispute");
    bytes32 private constant PROVIDER_ROOT = keccak256("provider");
    bytes32 private constant BUYER_ROOT = keccak256("buyer");

    VerityBondEscrow private escrow;
    Actor private buyer;
    Actor private provider;

    function setUp() public {
        escrow = new VerityBondEscrow(BOND);
        buyer = new Actor();
        provider = new Actor();
        vm.deal(address(buyer), 10 ether);
        vm.deal(address(provider), 10 ether);
    }

    function testBondAndStakeResolveToBuyerWhenProviderWasWrong() public {
        buyer.postBond{ value: BOND }(payable(address(escrow)), DISPUTE, PROVIDER_ROOT);
        provider.stake{ value: 2 ether }(payable(address(escrow)), PROVIDER_ROOT);
        escrow.lockStake(DISPUTE, 2 ether);

        uint256 beforeBalance = address(buyer).balance;
        escrow.resolveBond(DISPUTE, true, payable(address(buyer)), payable(address(provider)));

        require(address(buyer).balance == beforeBalance + 3 ether, "buyer did not receive bond and slash");
        require(escrow.providerStake(PROVIDER_ROOT) == 0, "stake was not slashed");
    }

    function testFalseRejectionPaysProviderAndUnlocksStake() public {
        buyer.postBond{ value: BOND }(payable(address(escrow)), DISPUTE, PROVIDER_ROOT);
        provider.stake{ value: 2 ether }(payable(address(escrow)), PROVIDER_ROOT);
        escrow.lockStake(DISPUTE, 2 ether);

        uint256 beforeBalance = address(provider).balance;
        escrow.resolveBond(DISPUTE, false, payable(address(buyer)), payable(address(provider)));

        require(address(provider).balance == beforeBalance + BOND, "provider did not receive dishonest bond");
        require(escrow.lockedStake(DISPUTE) == 0, "stake remained locked");
        provider.withdraw(payable(address(escrow)), PROVIDER_ROOT, 2 ether);
        require(escrow.providerStake(PROVIDER_ROOT) == 0, "provider stake was not withdrawable");
    }

    function testLockedStakeCannotBeWithdrawnOrLockedTwice() public {
        buyer.postBond{ value: BOND }(payable(address(escrow)), DISPUTE, PROVIDER_ROOT);
        provider.stake{ value: 3 ether }(payable(address(escrow)), PROVIDER_ROOT);
        escrow.lockStake(DISPUTE, 2 ether);

        (bool withdrawSuccess,) = address(provider).call(
            abi.encodeWithSelector(Actor.withdraw.selector, payable(address(escrow)), PROVIDER_ROOT, 2 ether)
        );
        require(!withdrawSuccess, "locked stake was withdrawable");

        (bool secondLockSuccess,) = address(escrow).call(
            abi.encodeWithSelector(VerityBondEscrow.lockStake.selector, DISPUTE, 1 ether)
        );
        require(!secondLockSuccess, "stake was locked twice");
        require(escrow.totalLockedStake(PROVIDER_ROOT) == 2 ether, "provider lock total was incorrect");
    }

    function testResolutionRecipientsMustMatchRecordedParties() public {
        buyer.postBond{ value: BOND }(payable(address(escrow)), DISPUTE, PROVIDER_ROOT);
        provider.stake{ value: 2 ether }(payable(address(escrow)), PROVIDER_ROOT);
        escrow.lockStake(DISPUTE, 2 ether);

        Actor other = new Actor();
        (bool success,) = address(escrow).call(
            abi.encodeWithSelector(
                VerityBondEscrow.resolveBond.selector,
                DISPUTE,
                true,
                payable(address(other)),
                payable(address(provider))
            )
        );
        require(!success, "operator redirected bond to an unrecorded buyer");
        (,,, bool resolved) = escrow.bonds(DISPUTE);
        require(!resolved, "invalid resolution changed bond state");
    }

    function testPlainTransferReverts() public {
        (bool success,) = address(escrow).call{ value: 1 wei }("");
        require(!success, "plain native transfer unexpectedly succeeded");
    }

    function testReputationAnchorStoresBothRoots() public {
        escrow.anchorReputation(PROVIDER_ROOT, BUYER_ROOT, false, false);
        (, uint64 providerIncorrect,,) = escrow.reputation(PROVIDER_ROOT);
        require(providerIncorrect == 1, "provider score missing");
        require(escrow.buyerDishonest(BUYER_ROOT) == 1, "buyer score missing");
    }
}
