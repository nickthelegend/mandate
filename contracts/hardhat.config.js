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
};
