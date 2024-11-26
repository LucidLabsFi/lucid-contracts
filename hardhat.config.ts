import * as dotenv from "dotenv";

import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-change-network";

dotenv.config();

let accounts: any;

if (process.env.PRIVATE_KEY) {
    accounts = [process.env.PRIVATE_KEY];
} else {
    accounts = {
        mnemonic: process.env.MNEMONIC,
    };
}

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.8.20",
                settings: {
                    evmVersion: "london",
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.8.19",
                settings: {
                    evmVersion: "london",
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.8.15",
                settings: {
                    evmVersion: "london",
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.8.9",
                settings: {
                    evmVersion: "london",
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.7.6",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.7.5",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.4.22",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
        ],
    },
    mocha: {
        timeout: 100000000,
    },
    networks: {
        hardhat: {
            chainId: 31337,
            gas: 12000000,
            // forking: {
            //   url: process.env.MUMBAI_URL || "",
            //   blockNumber: 34247760
            // }
        },
        goerli: {
            url: process.env.GOERLI_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            timeout: 0,
        },
        sepolia: {
            url: process.env.SEPOLIA_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            timeout: 0,
        },
        polygon: {
            url: process.env.POLYGON_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            timeout: 0,
        },
        polygonAmoy: {
            url: process.env.AMOY_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            chainId: 80002,
            //@ts-ignore
            // gasLimit: 20_000_000,
            // gas: 20_000_000,
            // gasPrice: 60000000000,
        },
        polygonZKtestnet: {
            url: process.env.POLYGONZK_TESTNET_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            timeout: 0,
            chainId: 1442,
        },
        arbitrumGoerli: {
            url: process.env.ARBITRUM_GOERLI_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            // gasPrice: 1600000000,
            // gasLimit: 20000000,
        },
        arbitrumSepolia: {
            url: process.env.ARBITRUM_SEPOLIA_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            // gasPrice: 1600000000,
            // gasLimit: 20000000,
        },
        optimismSepolia: {
            url: process.env.OPTIMISM_SEPOLIA_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            chainId: 11155420,
            // gasPrice: 500000000,
            // gasLimit: 20000000,
        },
        lineaSepolia: {
            url: process.env.LINEA_SEPOLIA_URL || "",
            accounts: {mnemonic: process.env.MNEMONIC},
            chainId: 59141,
        },
    },
    etherscan: {
        apiKey: {
            goerli: process.env.ETHERSCAN_API_KEY || "",
            polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
            polygon: process.env.POLYGONSCAN_API_KEY || "",
            polygonZKtestnet: process.env.POLYGONSCANZK_API_KEY || "",
            lineaSepolia: process.env.LINEASCAN_API_KEY || "",
            optimismSepolia: process.env.OPTIMISMSCAN_API_KEY || "",
            arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
            sepolia: process.env.ETHERSCAN_API_KEY || "",
        },
        customChains: [
            {
                network: "polygonAmoy",
                chainId: 80002,
                urls: {
                    apiURL: "https://api-amoy.polygonscan.com/api",
                    browserURL: "https://amoy.polygonscan.com/",
                },
            },
            {
                network: "polygonZKtestnet",
                chainId: 1442,
                urls: {
                    apiURL: "https://api-testnet-zkevm.polygonscan.com/api",
                    browserURL: "https://testnet-zkevm.polygonscan.com",
                },
            },
            {
                network: "lineaSepolia",
                chainId: 59141,
                urls: {
                    apiURL: "https://api-sepolia.lineascan.build/api",
                    browserURL: "https://sepolia.lineascan.build",
                },
            },
            {
                network: "optimismSepolia",
                chainId: 11155420,
                urls: {
                    apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
                    browserURL: "https://sepolia-optimistic.etherscan.io",
                },
            },
            {
                network: "arbitrumSepolia",
                chainId: 421614,
                urls: {
                    apiURL: "https://api-sepolia.arbiscan.io/api",
                    browserURL: "https://sepolia.arbiscan.io/",
                },
            },
            {
                network: "sepolia",
                chainId: 11155111,
                urls: {
                    apiURL: "https://api-sepolia.etherscan.io/api",
                    browserURL: "https://sepolia.etherscan.io",
                },
            },
        ],
    },
    // contractSizer: {
    //   alphaSort: true,
    //   disambiguatePaths: false,
    //   runOnCompile: true,
    //   strict: true,
    // },
};
export default config;
