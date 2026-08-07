require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

/*
 * Sepolia is the target. The hackathon organiser confirmed testnet submissions
 * are accepted and not marked down, and every claim this project makes is about
 * verification rather than about which chain carries the value.
 */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  /*
   * Off, because hardhat-verify still calls Sourcify's v1 API, which is in a
   * scheduled brownout until 2027 and 503s every time -- making a successful
   * Etherscan verification exit non-zero and look broken.
   *
   * Sourcify verification still happens, via scripts/verify-sourcify.mjs, which
   * posts to v2 directly and needs no API key at all.
   */
  sourcify: {
    enabled: false,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};
