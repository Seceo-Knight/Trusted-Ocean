// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @title Trusted Ocean anchor registry
/// @notice Records proofs of collected ocean data batches: the SHA-256 of the ML-DSA signed
///         manifest, the IPFS CID of the archive, the source and the collection time.
///         Data itself is never stored on-chain. An anchor can never be changed or removed.
contract TrustedOceanAnchor {
    struct Anchor {
        uint64 blockNumber;
        uint64 anchoredAt;  // block timestamp (seconds)
        uint64 fetchedAt;   // collection time (seconds)
        address submitter;
        string cid;
        string sourceId;
    }

    address public immutable owner;
    uint256 public count;
    mapping(address => bool) public writers;
    mapping(bytes32 => Anchor) private anchors;

    event Anchored(bytes32 indexed manifestHash, string cid, string sourceId, uint64 fetchedAt, address indexed submitter);
    event WriterSet(address indexed writer, bool allowed);

    constructor() {
        owner = msg.sender;
        writers[msg.sender] = true;
        emit WriterSet(msg.sender, true);
    }

    /// @notice Owner can allow or remove other submitting accounts (e.g. consortium partners).
    function setWriter(address writer, bool allowed) external {
        require(msg.sender == owner, "not owner");
        writers[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    function anchor(bytes32 manifestHash, string calldata cid, string calldata sourceId, uint64 fetchedAt) external {
        require(writers[msg.sender], "not allowed");
        require(manifestHash != bytes32(0), "empty hash");
        require(anchors[manifestHash].anchoredAt == 0, "already anchored");
        anchors[manifestHash] = Anchor(uint64(block.number), uint64(block.timestamp), fetchedAt, msg.sender, cid, sourceId);
        count += 1;
        emit Anchored(manifestHash, cid, sourceId, fetchedAt, msg.sender);
    }

    function getAnchor(bytes32 manifestHash) external view returns (
        bool exists, uint64 blockNumber, uint64 anchoredAt, uint64 fetchedAt, address submitter, string memory cid, string memory sourceId
    ) {
        Anchor storage a = anchors[manifestHash];
        return (a.anchoredAt != 0, a.blockNumber, a.anchoredAt, a.fetchedAt, a.submitter, a.cid, a.sourceId);
    }
}
