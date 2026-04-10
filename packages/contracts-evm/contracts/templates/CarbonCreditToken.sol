// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraChainBaseToken.sol";

/**
 * @title CarbonCreditToken
 * @author Cranebolt Technologies — Ankara Chain SDK
 * @notice Tokenized verified carbon credits for African conservation projects.
 *
 * Each token = 1 tonne of CO2 equivalent (1 tCO2e).
 * Use cases:
 * - REDD+ forest conservation (Nigeria, DRC, Kenya)
 * - Sustainable agriculture credits
 * - Renewable energy certificates
 * - Connecting African conservation to global carbon markets
 *
 * Key distinction: carbon credits can be RETIRED (permanently removed
 * from circulation to offset emissions). Retirement is irreversible
 * and fully tracked on-chain.
 */
contract CarbonCreditToken is AnkaraChainBaseToken {

    struct CarbonCreditMetadata {
        string  creditType;             // REDD+ | VCS | Gold Standard | GS4GG | CDM
        string  verificationBodyRef;    // Verification body and certificate ID
        uint256 vintageYear;            // Year the emission reduction occurred
        uint256 quantityCO2e;           // Total tonnes CO2e (18 decimal wei)
        string  projectLocation;        // GPS or country/region
        string  projectType;            // Forestry | Agriculture | Energy | Waste
        bytes32 verificationDocHash;    // IPFS CID of verification certificate
        uint256 lastUpdated;
    }

    CarbonCreditMetadata private _metadata;
    uint256 public metadataVersion;

    /// @notice Total credits retired (permanently offset) — in wei (1e18 = 1 tCO2e)
    uint256 public totalRetired;

    /// @notice Retirement records — who retired how much and when
    struct RetirementRecord {
        address retiredBy;
        uint256 amount;         // In wei
        uint256 timestamp;
        string  beneficiary;    // Who the retirement is on behalf of
        string  retirementNote; // Reason / project reference
    }

    RetirementRecord[] public retirements;

    event MetadataUpdated(uint256 indexed version, uint256 timestamp);
    event CreditsRetired(
        address indexed retiredBy,
        uint256 amount,
        string  beneficiary,
        uint256 retirementIndex,
        uint256 timestamp
    );

    uint256[50] private __gap;

    error ZeroRetirementAmount();
    error InsufficientBalance(uint256 available, uint256 requested);

    // ─── Initializer ────────────────────────────────────────────────────────

    function initialize(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_,
        address feeRecipient_,
        CarbonCreditMetadata memory metadata_
    ) external initializer {
        __AnkaraChainBaseToken_init(
            name_, symbol_, assetId_, countryCode_,
            admin_, verifier_, feeRecipient_
        );
        _metadata = metadata_;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion = 1;
        emit MetadataUpdated(1, block.timestamp);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function getMetadata() external view returns (CarbonCreditMetadata memory) {
        return _metadata;
    }

    function creditType() external view returns (string memory) {
        return _metadata.creditType;
    }

    function vintageYear() external view returns (uint256) {
        return _metadata.vintageYear;
    }

    function quantityCO2e() external view returns (uint256) {
        return _metadata.quantityCO2e;
    }

    function getRetirement(uint256 index)
        external
        view
        returns (RetirementRecord memory)
    {
        return retirements[index];
    }

    function totalRetirements() external view returns (uint256) {
        return retirements.length;
    }

    // ─── Retire Credits ─────────────────────────────────────────────────────

    /**
     * @notice Retire carbon credits — permanently removes from circulation.
     * @dev Burns tokens and records on-chain retirement proof.
     *      Retirement is IRREVERSIBLE. Only the token holder can retire
     *      their own credits.
     *
     * @param amount      Amount to retire in wei (1e18 = 1 tCO2e)
     * @param beneficiary Who the offset is on behalf of (company name, project)
     * @param note        Optional retirement reference / reason
     */
    function retire(
        uint256 amount,
        string memory beneficiary,
        string memory note
    ) external {
        if (amount == 0) revert ZeroRetirementAmount();
        uint256 bal = balanceOf(msg.sender);
        if (bal < amount) revert InsufficientBalance(bal, amount);

        // Burn the tokens permanently
        _burn(msg.sender, amount);

        totalRetired += amount;
        uint256 idx = retirements.length;
        retirements.push(RetirementRecord({
            retiredBy:      msg.sender,
            amount:         amount,
            timestamp:      block.timestamp,
            beneficiary:    beneficiary,
            retirementNote: note
        }));

        emit CreditsRetired(msg.sender, amount, beneficiary, idx, block.timestamp);
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(CarbonCreditMetadata memory metadata_)
        external
        onlyRole(MANAGER_ROLE)
    {
        _metadata = metadata_;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit MetadataUpdated(metadataVersion, block.timestamp);
    }
}
