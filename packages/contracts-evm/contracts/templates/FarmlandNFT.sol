// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraNFTBase.sol";

/**
 * @title FarmlandNFT
 * @author PIE Drops Studio
 * @notice Ankara Chain NFT template — unique on-chain deed for an agricultural land parcel.
 *
 * Each token = one physical farm parcel (legal title / Certificate of Occupancy).
 * Unlike the ERC-20 FarmlandToken (fractional shares), each NFT is a unique deed.
 * Documents (title deed, survey) stored on IPFS — referenced by CID hash.
 *
 * Use cases: digitising land registries, collateral for DeFi loans,
 * cross-border conveyance, diaspora land ownership verification.
 */
contract FarmlandNFT is AnkaraNFTBase {

    struct FarmlandNFTMetadata {
        string  location;           // GPS decimal degrees
        uint256 areaSqMeters;       // Land area in square metres
        string  soilType;           // loam | clay | sandy | silt | peaty
        string  irrigationType;     // none | rain-fed | drip | canal | borehole
        string  cropHistory;        // Last 3 seasons (e.g. "maize,sorghum,fallow")
        bytes32 titleDocumentHash;  // IPFS CID of title deed / C of O
        bytes32 surveyReportHash;   // IPFS CID of survey report
        string  stateRegion;        // State or province
        uint256 lastUpdated;        // Unix timestamp of last update
    }

    mapping(uint256 => FarmlandNFTMetadata) private _tokenMetadata;
    mapping(uint256 => uint256) public metadataVersion;

    event FarmlandNFTMinted(uint256 indexed tokenId, address indexed to, bytes32 assetId);
    event MetadataUpdated(uint256 indexed tokenId, uint256 version, uint256 timestamp);

    uint256[50] private __gap;

    // ─── Initializer ────────────────────────────────────────────────────────

    function initialize(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_
    ) external initializer {
        __AnkaraNFTBase_init(name_, symbol_, assetId_, countryCode_, admin_, verifier_);
    }

    // ─── Minting ────────────────────────────────────────────────────────────

    function mint(address to, FarmlandNFTMetadata memory meta)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        tokenId = _mintNext(to);
        meta.lastUpdated = block.timestamp;
        _tokenMetadata[tokenId] = meta;
        metadataVersion[tokenId] = 1;
        emit FarmlandNFTMinted(tokenId, to, this.assetId());
        emit MetadataUpdated(tokenId, 1, block.timestamp);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function getMetadata(uint256 tokenId)
        external
        view
        returns (FarmlandNFTMetadata memory)
    {
        return _tokenMetadata[tokenId];
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(uint256 tokenId, FarmlandNFTMetadata memory meta)
        external
        onlyRole(MANAGER_ROLE)
    {
        meta.lastUpdated = block.timestamp;
        _tokenMetadata[tokenId] = meta;
        uint256 version = ++metadataVersion[tokenId];
        emit MetadataUpdated(tokenId, version, block.timestamp);
    }

    function updateTitleDocument(uint256 tokenId, bytes32 newHash)
        external
        onlyRole(MANAGER_ROLE)
    {
        _tokenMetadata[tokenId].titleDocumentHash = newHash;
        _tokenMetadata[tokenId].lastUpdated = block.timestamp;
        uint256 version = ++metadataVersion[tokenId];
        emit MetadataUpdated(tokenId, version, block.timestamp);
    }
}
