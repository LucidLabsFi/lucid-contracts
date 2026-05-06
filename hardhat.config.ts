import * as dotenv from "dotenv";

import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-change-network";
// import "hardhat-gas-reporter";
// import "hardhat-docgen";

dotenv.config();

let accounts: any;

if (process.env.PRIVATE_KEY) {
    accounts = [process.env.PRIVATE_KEY];
} else {
    accounts = {
        mnemonic: process.env.MNEMONIC,
    };
}
const config = {
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
                version: "0.6.12",
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
            accounts: accounts,
            timeout: 0,
        },
        sepolia: {
            url: process.env.SEPOLIA_URL || "",
            accounts: accounts,
            timeout: 0,
            //gasPrice: 25000000000,
        },
        polygonAmoy: {
            url: process.env.AMOY_URL || "",
            accounts: accounts,
            chainId: 80002,
            //@ts-ignore
            // gasLimit: 20_000_000,
            //gas: 20_000_000,
            gasPrice: 60000000000,
        },
        polygonZKtestnet: {
            url: process.env.POLYGONZK_TESTNET_URL || "",
            accounts: accounts,
            timeout: 0,
            chainId: 1442,
        },
        arbitrumGoerli: {
            url: process.env.ARBITRUM_GOERLI_URL || "",
            accounts: accounts,
            // gasPrice: 1600000000,
            // gasLimit: 20000000,
        },
        arbitrumSepolia: {
            url: process.env.ARBITRUM_SEPOLIA_URL || "",
            accounts: accounts,
            // gasPrice: 1600000000,
            // gasLimit: 20000000,
        },
        optimismSepolia: {
            url: process.env.OPTIMISM_SEPOLIA_URL || "",
            accounts: accounts,
            chainId: 11155420,
            // gasPrice: 500000000,
            // gasLimit: 20000000,
        },
        baseSepolia: {
            url: process.env.BASE_SEPOLIA_URL || "https://sepolia.base.org",
            accounts: accounts,
            chainId: 84532,
        },
        lineaSepolia: {
            url: process.env.LINEA_SEPOLIA_URL || "",
            accounts: accounts,
            chainId: 59141,
        },
        opDevnet0: {
            url: "https://interop-alpha-0.optimism.io",
            accounts: accounts,
            chainId: 420120000,
            gasPrice: 100000,
        },
        opDevnet1: {
            url: "https://interop-alpha-1.optimism.io",
            accounts: accounts,
            chainId: 420120001,
            gasPrice: 100000,
        },
        opLocal0: {
            url: "http://127.0.0.1:9545",
            accounts: accounts,
            chainId: 901,
        },
        opLocal1: {
            url: "http://127.0.0.1:9546",
            accounts: accounts,
            chainId: 902,
        },
        ethereum: {
            url: process.env.ETHEREUM_MAINNET_URL || "",
            accounts: accounts,
            chainId: 1,
            timeout: 0,
        },
        arbitrum: {
            // Arbitrum One
            url: process.env.ARBITRUM_MAINNET_URL || "",
            accounts: accounts,
            chainId: 42161,
            timeout: 0,
        },
        optimism: {
            url: process.env.OPTIMISM_MAINNET_URL || "",
            accounts: accounts,
            chainId: 10,
            timeout: 0,
        },
        base: {
            url: process.env.BASE_MAINNET_URL || "",
            accounts: accounts,
            chainId: 8453,
            timeout: 0,
        },
        linea: {
            url: process.env.LINEA_MAINNET_URL || "",
            accounts: accounts,
            chainId: 59144,
            timeout: 0,
        },
        blast: {
            url: process.env.BLAST_MAINNET_URL || "",
            accounts: accounts,
            chainId: 81457,
            timeout: 0,
        },
        polygon: {
            url: process.env.POLYGON_MAINNET_URL || "",
            accounts: accounts,
            chainId: 137,
            timeout: 0,
            gasMultiplier: 1.3,
        },
        fraxtal: {
            url: process.env.FRAXTAL_MAINNET_URL || "",
            accounts: accounts,
            chainId: 252,
            timeout: 0,
        },
        manta: {
            url: "https://1rpc.io/manta",
            accounts: accounts,
            chainId: 169,
            timeout: 0,
        },
        zircuit: {
            url: "https://zircuit-mainnet.drpc.org",
            accounts: accounts,
            chainId: 48900,
            timeout: 0,
        },
        xlayer: {
            url: "https://xlayer.drpc.org",
            accounts: accounts,
            chainId: 196,
            timeout: 0,
        },
        peaq: {
            url: "https://quicknode.peaq.xyz/",
            accounts: accounts,
            chainId: 3338,
            timeout: 0,
        },
        unichain: {
            url: "https://mainnet.unichain.org",
            accounts: accounts,
            chainId: 130,
            timeout: 0,
        },
        berachain: {
            url: "https://rpc.berachain.com",
            accounts: accounts,
            chainId: 80094,
            timeout: 0,
        },
        sonic: {
            url: "https://rpc.soniclabs.com",
            accounts: accounts,
            chainId: 146,
            timeout: 0,
        },
        hyperliquid: {
            url: "https://rpc.hyperliquid.xyz/evm",
            accounts: accounts,
            chainId: 999,
            timeout: 0,
            // gasMultiplier: 1.3,
        },
        mantle: {
            url: process.env.MANTLE_MAINNET_URL,
            accounts: accounts,
            chainId: 5000,
            timeout: 0,
            gasMultiplier: 1.3,
        },
        redBelly: {
            url: "https://governors.mainnet.redbelly.network",
            accounts: accounts,
            chainId: 151,
            timeout: 0,
        },
        boba: {
            url: "https://mainnet.boba.network",
            accounts: accounts,
            chainId: 288,
            timeout: 0,
            gasPrice: 100000,
        },
        saakuru: {
            url: "https://rpc.saakuru.network/",
            accounts: accounts,
            chainId: 7225878,
            timeout: 0,
            gasPrice: 0,
        },
        bnb: {
            url: "https://bsc-dataseed1.bnbchain.org",
            accounts: accounts,
            chainId: 56,
            timeout: 0,
        },
        gnosis: {
            url: "https://rpc.gnosischain.com",
            accounts: accounts,
            chainId: 100,
            timeout: 0,
        },
        bsquared: {
            url: "https://rpc.ankr.com/b2",
            accounts: accounts,
            chainId: 223,
            timeout: 0,
        },
        plume: {
            url: "https://rpc.plume.org",
            accounts: accounts,
            chainId: 98866,
            timeout: 0,
        },
        bob: {
            url: "https://rpc.gobob.xyz/",
            accounts: accounts,
            chainId: 60808,
            timeout: 0,
        },
        mantra: {
            url: "https://evm.mantrachain.io",
            accounts: accounts,
            chainId: 5888,
            timeout: 0,
        },
        avalanche: {
            url: process.env.AVALANCHE_MAINNET_URL || "",
            accounts: accounts,
            chainId: 43114,
            timeout: 0,
            gasMultiplier: 2,
        },
        kiteai: {
            url: "https://rpc-ireland.gokite.ai/",
            accounts: accounts,
            chainId: 2366,
            timeout: 0,
        },
        celo: {
            url: "https://forno.celo.org",
            accounts: accounts,
            chainId: 42220,
            timeout: 0,
        },
    },
    etherscan: {
        apiKey: {
            goerli: process.env.ETHERSCAN_API_KEY || "",
            polygonAmoy: process.env.ETHERSCAN_API_KEY || "",
            polygonZKtestnet: process.env.ETHERSCAN_API_KEY || "",
            lineaSepolia: process.env.ETHERSCAN_API_KEY || "",
            optimismSepolia: process.env.ETHERSCAN_API_KEY || "",
            baseSepolia: process.env.ETHERSCAN_API_KEY || "",
            arbitrumSepolia: process.env.ETHERSCAN_API_KEY || "",
            sepolia: process.env.ETHERSCAN_API_KEY || "",
            ethereum: process.env.ETHERSCAN_API_KEY || "",
            arbitrum: process.env.ETHERSCAN_API_KEY || "",
            optimism: process.env.ETHERSCAN_API_KEY || "",
            base: process.env.ETHERSCAN_API_KEY || "",
            linea: process.env.ETHERSCAN_API_KEY || "",
            blast: process.env.ETHERSCAN_API_KEY || "",
            polygon: process.env.ETHERSCAN_API_KEY || "",
            fraxtal: process.env.FRAXSCAN_API_KEY || "",
            unichain: "empty", // No API key for Unichain
            hyperliquid: process.env.ETHERSCAN_API_KEY, // No API key for hyperliquid
            redBelly: "empty", // No API key for RedBelly
            boba: "empty", // No API key for Boba
            saakuru: "empty",
            bsquared: "empty", // No API key for B-Squared
            plume: "empty", // No API key for Plume
            bob: "empty", // No API key for Bob
            mantra: "empty", // No API key for Mantra
            gnosis: process.env.ETHERSCAN_API_KEY,
            bnb: process.env.ETHERSCAN_API_KEY,
            berachain: process.env.ETHERSCAN_API_KEY || "",
            sonic: process.env.ETHERSCAN_API_KEY || "",
            mantle: process.env.ETHERSCAN_API_KEY || "",
            avalanche: "empty", // No API key for Avalanche
            kiteai: "empty", // No API key for KiteAI
            celo: process.env.ETHERSCAN_API_KEY || "",
        },
        customChains: [
            {
                network: "optimism",
                chainId: 10,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=10",
                    browserURL: "https://optimistic.etherscan.io/",
                },
            },
            {
                network: "base",
                chainId: 8453,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
                    browserURL: "https://basescan.org/",
                },
            },
            {
                network: "blast",
                chainId: 81457,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=81457",
                    browserURL: "https://blastscan.io/",
                },
            },
            {
                network: "polygon",
                chainId: 137,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=137",
                    browserURL: "https://polygonscan.com/",
                },
            },
            {
                network: "linea",
                chainId: 59144,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=59144",
                    browserURL: "https://lineascan.build/",
                },
            },
            {
                network: "ethereum",
                chainId: 1,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=1",
                    browserURL: "https://etherscan.io/",
                },
            },
            {
                network: "arbitrum",
                chainId: 42161,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=42161",
                    browserURL: "https://arbiscan.io/",
                },
            },
            {
                network: "fraxtal",
                chainId: 252,
                urls: {
                    apiURL: "https://api.fraxscan.com/api",
                    browserURL: "https://fraxscan.com",
                },
            },
            {
                network: "baseSepolia",
                chainId: 84532,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
                    browserURL: "https://sepolia.basescan.org/",
                },
            },
            {
                network: "unichain",
                chainId: 130,
                urls: {
                    apiURL: "https://unichain.blockscout.com/api",
                    browserURL: "https://unichain.blockscout.com/",
                },
            },
            {
                network: "berachain",
                chainId: 80094,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=80094",
                    browserURL: "https://berascan.com/",
                },
            },
            {
                network: "sonic",
                chainId: 146,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=146",
                    browserURL: "https://sonicscan.org/",
                },
            },
            {
                network: "hyperliquid",
                chainId: 999,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=999",
                    browserURL: "https://www.hyperscan.com/",
                },
            },
            {
                network: "mantle",
                chainId: 5000,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=5000",
                    browserURL: "https://mantlescan.xyz/",
                },
            },
            {
                network: "redBelly",
                chainId: 151,
                urls: {
                    apiURL: "https://api.routescan.io/v2/network/mainnet/evm/151/etherscan",
                    browserURL: "https://redbelly.routescan.io",
                },
            },
            {
                network: "boba",
                chainId: 288,
                urls: {
                    apiURL: "https://api.routescan.io/v2/network/mainnet/evm/288/etherscan",
                    browserURL: "https://boba.routescan.io",
                },
            },
            {
                network: "saakuru",
                chainId: 7225878,
                urls: {
                    apiURL: "https://explorer.saakuru.network/api",
                    browserURL: "https://explorer.saakuru.network",
                },
            },
            {
                network: "bnb",
                chainId: 56,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=56",
                    browserURL: "https://bscscan.com/",
                },
            },
            {
                network: "gnosis",
                chainId: 100,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=100",
                    browserURL: "https://gnosisscan.io/",
                },
            },
            {
                network: "bsquared",
                chainId: 223,
                urls: {
                    apiURL: "https://12d6a1773a-backend-blockscout.bsquared.network/api/api",
                    browserURL: "https://12d6a1773a-frontent-blockscout.bsquared.network",
                },
            },
            {
                network: "plume",
                chainId: 98866,
                urls: {
                    apiURL: "https://explorer.plume.org/api",
                    browserURL: "https://explorer.plume.org/",
                },
            },
            {
                network: "bob",
                chainId: 60808,
                urls: {
                    apiURL: "https://explorer.gobob.xyz/api",
                    browserURL: "https://explorer.gobob.xyz/",
                },
            },
            {
                network: "mantra",
                chainId: 5888,
                urls: {
                    apiURL: "https://blockscout.mantrascan.io/api",
                    browserURL: "https://blockscout.mantrascan.io",
                },
            },
            {
                network: "avalanche",
                chainId: 43114,
                urls: {
                    apiURL: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan",
                    browserURL: "https://snowtrace.io/",
                },
            },
            {
                network: "kiteai",
                chainId: 2366,
                urls: {
                    apiURL: "https://www.kitescan.ai/api",
                    browserURL: "https://www.kitescan.ai",
                },
            },
            {
                network: "celo",
                chainId: 42220,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=42220",
                    browserURL: "https://celoscan.io/",
                },
            },
            // {
            //     network: "polygonAmoy",
            //     chainId: 80002,
            //     urls: {
            //         apiURL: "https://api-amoy.polygonscan.com/api",
            //         browserURL: "https://amoy.polygonscan.com/",
            //     },
            // },
            // {
            //     network: "polygonAmoy",
            //     chainId: 80002,
            //     urls: {
            //         apiURL: "https://api-amoy.polygonscan.com/api",
            //         browserURL: "https://amoy.polygonscan.com/",
            //     },
            // },
            // {
            //     network: "polygonAmoy",
            //     chainId: 80002,
            //     urls: {
            //         apiURL: "https://api-amoy.polygonscan.com/api",
            //         browserURL: "https://amoy.polygonscan.com/",
            //     },
            // },
            // {
            //     network: "polygonAmoy",
            //     chainId: 80002,
            //     urls: {
            //         apiURL: "https://api-amoy.polygonscan.com/api",
            //         browserURL: "https://amoy.polygonscan.com/",
            //     },
            // },
            {
                network: "polygonAmoy",
                chainId: 80002,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=80002",
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
                    apiURL: "https://api.etherscan.io/v2/api?chainid=59141",
                    browserURL: "https://sepolia.lineascan.build",
                },
            },
            {
                network: "optimismSepolia",
                chainId: 11155420,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=11155420",
                    browserURL: "https://sepolia-optimistic.etherscan.io",
                },
            },
            {
                network: "arbitrumSepolia",
                chainId: 421614,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=421614",
                    browserURL: "https://sepolia.arbiscan.io/",
                },
            },
            {
                network: "sepolia",
                chainId: 11155111,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=11155111",
                    browserURL: "https://sepolia.etherscan.io",
                },
            },
        ],
    },
    // sourcify: {
    //     // Disabled by default
    //     // Doesn't need an API key
    //     enabled: true,
    // },
    // docgen: {
    //     path: "./docs",
    //     clear: true,
    //     runOnCompile: false,
    // },
    // contractSizer: {
    //   alphaSort: true,
    //   disambiguatePaths: false,
    //   runOnCompile: true,
    //   strict: true,
    // },
    // gasReporter: {
    //     enabled: process.env.REPORT_GAS ? true : false,
    // },
};
export default config;
