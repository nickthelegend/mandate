// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title MandateReceipts
/// @notice Anchors the merkle root of a batch of decision receipts.
///
/// Deliberately tiny, and deliberately separate from `PolicyRegistry`. The
/// registry governs whether an agent may spend; this records what was decided.
/// Putting them in one contract would mean an upgrade to the evidence trail
/// required touching the thing that gates the money, and those two should not
/// share a blast radius.
///
/// What is stored is a root and nothing else. The receipts themselves live in
/// the operator's database — publishing who they pay and for what would be a
/// privacy leak dressed up as transparency — and a holder proves membership
/// with a merkle proof against the root anchored here.
///
/// There is no delete and no update. A batch root can be written once; a second
/// write for the same batch id reverts rather than silently replacing, because
/// an evidence trail whose entries can be rewritten is not one.
contract MandateReceipts {
    struct Anchor {
        bytes32 root;
        uint64 anchoredAt;
        address anchoredBy;
    }

    /// @notice batchId => the root anchored for it.
    mapping(bytes32 batchId => Anchor anchor) private _anchors;

    /// @notice Total batches anchored, so a reader can page without an indexer.
    uint256 public batchCount;

    event BatchAnchored(
        bytes32 indexed batchId,
        bytes32 indexed root,
        address indexed anchoredBy,
        uint64 anchoredAt
    );

    error AlreadyAnchored(bytes32 batchId);
    error EmptyRoot();

    /// @notice Anchor a batch of receipts by its merkle root.
    /// @dev Permissionless on purpose. The anchor proves a root existed at a
    ///      block, and the event records who wrote it; it does not certify that
    ///      the writer is anybody in particular. A reader who cares checks
    ///      `anchoredBy` against the operator they expected, which is a stronger
    ///      position than trusting an owner check they cannot audit.
    function anchorReceiptBatch(bytes32 batchId, bytes32 root) external {
        if (root == bytes32(0)) revert EmptyRoot();
        if (_anchors[batchId].root != bytes32(0)) revert AlreadyAnchored(batchId);

        _anchors[batchId] = Anchor({
            root: root,
            anchoredAt: uint64(block.timestamp),
            anchoredBy: msg.sender
        });
        unchecked {
            ++batchCount;
        }

        emit BatchAnchored(batchId, root, msg.sender, uint64(block.timestamp));
    }

    /// @notice The anchor for a batch. A zero root means never anchored.
    function getAnchor(bytes32 batchId) external view returns (Anchor memory) {
        return _anchors[batchId];
    }

    /// @notice Whether this exact root was anchored under this batch id.
    /// @dev The check a verifier actually wants: they hold a receipt, they
    ///      computed a root from their proof, and they are asking whether the
    ///      chain agrees. One call, no event scanning.
    function isAnchored(bytes32 batchId, bytes32 root) external view returns (bool) {
        return root != bytes32(0) && _anchors[batchId].root == root;
    }
}
