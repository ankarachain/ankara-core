// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAnkaraOracle
 * @author Cranebolt Technologies
 * @notice Price feed interface for Ankara Chain oracle integrations.
 *
 * Implementations:
 * - ManualOracle  — MANAGER_ROLE sets prices manually (testing + MVP)
 * - ChainlinkOracle — wraps Chainlink price feeds (production)
 * - AIOracle      — AI-powered valuation for African asset classes (Phase 4)
 *
 * All prices are in USD with 18 decimal precision (1e18 = $1.00).
 */
interface IAnkaraOracle {
    /**
     * @notice Returns the latest USD price for a token address.
     * @param tokenAddress The ERC-20 token contract address to price.
     * @return priceUSD  Price in USD with 18 decimal precision (1e18 = $1.00).
     * @return timestamp Unix timestamp when this price was recorded.
     */
    function getPrice(address tokenAddress)
        external
        view
        returns (uint256 priceUSD, uint256 timestamp);

    /**
     * @notice Returns true if the price data for a token is considered stale.
     * @dev Staleness is implementation-defined (e.g. age threshold, confidence threshold).
     *      PoolVault reverts deposits when the relevant price is stale.
     */
    function isStale(address tokenAddress) external view returns (bool);
}
