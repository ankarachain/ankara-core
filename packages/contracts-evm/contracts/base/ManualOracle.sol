// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/IAnkaraOracle.sol";

/**
 * @title ManualOracle
 * @author PIE Drops Studio
 * @notice Reference IAnkaraOracle implementation — MANAGER_ROLE sets prices manually.
 *
 * Use cases:
 * - Testing and development (fast price updates without external dependencies)
 * - MVP deployments before Chainlink or AI oracle integration
 * - Illiquid African asset classes with no on-chain price feed
 *
 * Not upgradeable (no proxy) — deploy a new instance to change logic.
 * Prices expire after `stalenessThreshold` seconds (default: 24 hours).
 */
contract ManualOracle is AccessControl, IAnkaraOracle {
    // ─── Roles ─────────────────────────────────────────────────────────────
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // ─── Types ─────────────────────────────────────────────────────────────
    struct PriceData {
        uint256 priceUSD;   // USD price with 18 decimal precision
        uint256 timestamp;  // Unix timestamp when price was set
    }

    // ─── State ─────────────────────────────────────────────────────────────
    mapping(address => PriceData) private _prices;
    uint256 public stalenessThreshold; // seconds; price older than this is stale

    // ─── Events ────────────────────────────────────────────────────────────
    event PriceSet(address indexed token, uint256 priceUSD, uint256 timestamp);
    event StalenessThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ─── Errors ────────────────────────────────────────────────────────────
    error ZeroAddress();

    // ─── Constructor ───────────────────────────────────────────────────────

    /**
     * @param admin_               Address granted DEFAULT_ADMIN_ROLE and MANAGER_ROLE.
     * @param stalenessThreshold_  Seconds after which a price is considered stale.
     *                             Pass 86400 for 24-hour staleness (recommended default).
     */
    constructor(address admin_, uint256 stalenessThreshold_) {
        if (admin_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MANAGER_ROLE,       admin_);
        stalenessThreshold = stalenessThreshold_;
    }

    // ─── Price management ───────────────────────────────────────────────────

    /**
     * @notice Set the USD price for a token address.
     * @dev MANAGER_ROLE. Timestamp is set to block.timestamp automatically.
     * @param token    ERC-20 token contract address to price.
     * @param priceUSD Price in USD with 18 decimal precision (1e18 = $1.00).
     */
    function setPrice(address token, uint256 priceUSD)
        external
        onlyRole(MANAGER_ROLE)
    {
        _prices[token] = PriceData({ priceUSD: priceUSD, timestamp: block.timestamp });
        emit PriceSet(token, priceUSD, block.timestamp);
    }

    /**
     * @notice Update the staleness threshold.
     * @dev MANAGER_ROLE.
     */
    function setStalenessThreshold(uint256 newThreshold)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 old = stalenessThreshold;
        stalenessThreshold = newThreshold;
        emit StalenessThresholdUpdated(old, newThreshold);
    }

    // ─── IAnkaraOracle ──────────────────────────────────────────────────────

    /**
     * @notice Returns the latest price and timestamp for a token.
     * @return priceUSD  0 if price has never been set.
     * @return timestamp 0 if price has never been set.
     */
    function getPrice(address token)
        external
        view
        override
        returns (uint256 priceUSD, uint256 timestamp)
    {
        PriceData memory p = _prices[token];
        return (p.priceUSD, p.timestamp);
    }

    /**
     * @notice Returns true if the price for a token is stale or was never set.
     * @dev A price is stale if:
     *      - It was never set (timestamp == 0), OR
     *      - More than `stalenessThreshold` seconds have elapsed since the last update.
     */
    function isStale(address token) external view override returns (bool) {
        uint256 ts = _prices[token].timestamp;
        if (ts == 0) return true; // never set
        return block.timestamp - ts > stalenessThreshold;
    }
}
