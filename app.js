import { ethers } from 'https://cdn.skypack.dev/ethers@5.7.2';

// Market contract addresses
const MARKET_ADDRESSES = {
    WETH: '0xc4d4500326981eacD020e20A81b1c479c161c7EF',
    wstETH: '0x22ab31Cd55130435b5efBf9224b6a9d5EC36533F',
    WBTC: '0x6f748FD65d7c71949BA6641B3248C4C191F3b322',
    USDC: '0x6926B434CCe9b5b7966aE1BfEef6D0A7DCF3A8bb',
    'USDC.e': '0x81C9A7B55A4df39A9B7B5F781ec0e53539694873',
    OP: '0xa430A427bd00210506589906a71B54d6C256CEdb'
};

// Asset icons mapping
const ASSET_ICONS = {
    WETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
    wstETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0/logo.png',
    WBTC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
    USDC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
    'USDC.e': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
    OP: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/assets/0x4200000000000000000000000000000000000042/logo.png'
};

const decimalsMap = {
    WETH: 18,
    wstETH: 18,
    WBTC: 8,
    USDC: 6,
    'USDC.e': 6,
    OP: 18
};

// Constants for maturity calculation
const INTERVAL = 2419200; // 28 days in seconds

// Cache for the ABI
let cachedAbi = null;
let provider = null;
let currentMarketData = null; // Store current market data for CSV export

// Global variables and helper functions for USD display
let useUsd = false;
let assetPrices = null;

const COINGECKO_IDS = {
    WETH: 'ethereum',
    wstETH: 'wrapped-steth',
    WBTC: 'wrapped-bitcoin',
    USDC: 'usd-coin',
    'USDC.e': 'usd-coin',
    OP: 'optimism'
};

function formatUsd(value) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displayValue(assetSymbol, rawValue, formattedValue) {
    if (useUsd && assetPrices && assetPrices[assetSymbol] != null) {
        return '$' + formatUsd(rawValue * assetPrices[assetSymbol]);
    }
    return formattedValue + ' ' + assetSymbol;
}

async function fetchAssetPrices() {
    const uniqueIds = [...new Set(Object.values(COINGECKO_IDS))].join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueIds}&vs_currencies=usd`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch asset prices: ${response.statusText}`);
    }
    const data = await response.json();
    let prices = {};
    for (const symbol in COINGECKO_IDS) {
        const id = COINGECKO_IDS[symbol];
        prices[symbol] = data[id] ? data[id].usd : null;
    }
    return prices;
}

// Format number from wei to decimal
function formatFromWei(number, decimals = 18) {
    if (!number) return '0';
    return ethers.utils.formatUnits(number, decimals);
}

// Format number with commas and fixed decimal places
function formatNumber(number, decimals) {
    if (!number) return '0';
    
    // Split the number into integer and decimal parts
    const parts = number.toString().split('.');
    const integerPart = parts[0];
    const decimalPart = parts[1] || '';
    
    // Add commas to integer part
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    
    // Return with full decimal precision
    return decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

// Calculate pool maturity timestamp
function calculateMaturity(timestamp) {
    return timestamp - (timestamp % INTERVAL) + INTERVAL;
}

// Format timestamp to human readable date
function formatMaturityDate(timestamp) {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Calculate time remaining in seconds
function getTimeRemaining(maturityTimestamp) {
    const now = Math.floor(Date.now() / 1000);
    const remaining = maturityTimestamp - now;
    return remaining > 0 ? remaining : 0;
}

// Retry function for failed requests
async function retryRequest(fn, maxAttempts = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await fn();
            if (result !== null) {
                return result;
            }
            // If we got a null result (204), wait and retry
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return null;
}

// Get market color scheme
function getMarketColors(symbol) {
    const colors = {
        WETH: { bg: '#ecf4ff', border: '#c5dbff', text: '#1a56db' },
        wstETH: { bg: '#edfcf4', border: '#c3e6d3', text: '#0f662c' },
        WBTC: { bg: '#fff7ed', border: '#ffedd5', text: '#9a3412' },
        USDC: { bg: '#f0fdf4', border: '#dcfce7', text: '#166534' },
        'USDC.e': { bg: '#f0fdf4', border: '#dcfce7', text: '#166534' },
        OP: { bg: '#fef2f2', border: '#fee2e2', text: '#991b1b' }
    };
    return colors[symbol] || { bg: '#f8f9fa', border: '#e9ecef', text: '#333333' };
}

// Function to create a market card
function createMarketCard(market) {
    const colors = getMarketColors(market.symbol);
    // Define display values based on the current toggle mode (asset vs USD)
    const floatingDepositsDisplay = displayValue(market.symbol, market.floatingDepositsRaw, market.floatingDeposits);
    const floatingBorrowsDisplay = displayValue(market.symbol, market.floatingBorrowsRaw, market.floatingBorrows);

    const marketCard = document.createElement('div');
    marketCard.className = 'market-card';
    marketCard.style.cssText = `
        background: #ffffff;
        border-radius: 12px;
        padding: 24px;
        margin: 16px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        width: calc(100% - 32px);
        max-width: 1000px;
        border: 1px solid ${colors.border};
    `;

    const header = document.createElement('div');
    header.className = 'market-header';
    header.style.cssText = `
        border-bottom: 1px solid ${colors.border};
        padding-bottom: 16px;
        margin-bottom: 16px;
        background: ${colors.bg};
        margin: -24px -24px 24px -24px;
        padding: 24px;
        border-radius: 12px 12px 0 0;
    `;
    // Add asset price next to the market title
    const price = (assetPrices && assetPrices[market.symbol]) ? "$" + formatUsd(assetPrices[market.symbol]) : "Price loading...";
    header.innerHTML = `
        <h2 class="market-title" style="margin: 0; color: ${colors.text}; font-size: 24px; font-weight: 600;">
            <img src="${ASSET_ICONS[market.symbol]}" alt="${market.symbol} icon" style="width: 24px; height: 24px; margin-right: 8px;">
            ${market.name} <span style="font-size: 0.8em; color: gray; margin-left: 8px;">(${price})</span>
        </h2>
    `;

    const stats = document.createElement('div');
    stats.className = 'market-stats';
    stats.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
    `;
    stats.innerHTML = `
        <div class="stat-item" style="background: ${colors.bg}; padding: 16px; border-radius: 8px; border: 1px solid ${colors.border};">
            <div class="stat-label" style="color: ${colors.text}; font-size: 14px; margin-bottom: 8px; font-weight: 500;">Floating Deposits</div>
            <div class="stat-value" style="color: ${colors.text}; font-size: 16px; font-family: monospace;">${floatingDepositsDisplay}</div>
        </div>
        <div class="stat-item" style="background: ${colors.bg}; padding: 16px; border-radius: 8px; border: 1px solid ${colors.border};">
            <div class="stat-label" style="color: ${colors.text}; font-size: 14px; margin-bottom: 8px; font-weight: 500;">Floating Borrows</div>
            <div class="stat-value" style="color: ${colors.text}; font-size: 16px; font-family: monospace;">${floatingBorrowsDisplay}</div>
        </div>
    `;

    const poolsContainer = document.createElement('div');
    poolsContainer.className = 'fixed-pools';
    poolsContainer.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 16px;
    `;

    market.fixedPools.forEach(pool => {
        const poolElement = document.createElement('div');
        poolElement.className = 'fixed-pool';
        poolElement.style.cssText = `
            background: ${colors.bg};
            border-radius: 8px;
            padding: 16px;
            border: 1px solid ${colors.border};
        `;
        poolElement.innerHTML = `
            <h3 class="fixed-pool-title" style="margin: 0 0 16px 0; color: ${colors.text}; font-size: 16px; font-weight: 600;">
                Maturity: ${formatMaturityDate(pool.maturity)}
                <span style="color: ${colors.text}; opacity: 0.7; font-size: 14px; margin-left: 8px;">
                    (${getTimeRemaining(pool.maturity)} seconds left)
                </span>
            </h3>
            <div style="display: grid; gap: 12px;">
                <div class="stat-item">
                    <div class="stat-label" style="color: ${colors.text}; font-size: 14px; margin-bottom: 4px; opacity: 0.8;">Deposits</div>
                    <div class="stat-value" style="color: ${colors.text}; font-size: 14px; font-family: monospace;">${displayValue(market.symbol, pool.depositsRaw, pool.deposits)}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label" style="color: ${colors.text}; font-size: 14px; margin-bottom: 4px; opacity: 0.8;">Borrows</div>
                    <div class="stat-value" style="color: ${colors.text}; font-size: 14px; font-family: monospace;">${displayValue(market.symbol, pool.borrowsRaw, pool.borrows)}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label" style="color: ${colors.text}; font-size: 14px; margin-bottom: 4px; opacity: 0.8;">Pending Interests</div>
                    <div class="stat-value" style="color: ${colors.text}; font-size: 14px; font-family: monospace;">${displayValue(market.symbol, pool.unassignedEarningsRaw, pool.unassignedEarnings)}</div>
                </div>
            </div>
        `;
        poolsContainer.appendChild(poolElement);
    });

    marketCard.appendChild(header);
    marketCard.appendChild(stats);
    marketCard.appendChild(poolsContainer);

    return marketCard;
}

// Initialize provider and load ABI
async function initialize() {
    if (!provider) {
        provider = new ethers.providers.JsonRpcProvider('https://mainnet.optimism.io');
    }
    
    if (!cachedAbi) {
        try {
            const response = await fetch('abi/MarketWETH.json');
            if (!response.ok) {
                throw new Error(`Failed to fetch ABI: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            cachedAbi = data.abi;
        } catch (error) {
            console.error('Error loading ABI:', error);
            throw error;
        }
    }
    
    return { provider, abi: cachedAbi };
}

// Function to fetch market data from the blockchain
async function fetchMarketData() {
    const markets = [];
    
    try {
        const { provider, abi } = await initialize();
        
        // Get current block timestamp
        const currentBlock = await provider.getBlock('latest');
        const currentTimestamp = currentBlock.timestamp;
        
        // Calculate first maturity
        let firstMaturity = calculateMaturity(currentTimestamp);
        
        // Generate array of next 7 maturities
        const maturities = Array.from({ length: 7 }, (_, i) => firstMaturity + (i * INTERVAL));
        
        // Fetch data for all markets in parallel with increased retries and delay
        const marketPromises = Object.entries(MARKET_ADDRESSES).map(async ([symbol, address]) => {
            try {
                console.log(`Fetching data for ${symbol} market...`);
                const contract = new ethers.Contract(address, abi, provider);
                const decimals = decimalsMap[symbol];

                // Get floating assets and debt in parallel with retry
                const [floatingAssets, totalFloatingBorrowAssets] = await Promise.all([
                    retryRequest(() => contract.totalAssets(), 5, 2000),
                    retryRequest(() => contract.totalFloatingBorrowAssets(), 5, 2000)
                ]);

                // Get all pools data in parallel using maturity timestamps with retry
                const poolPromises = maturities.map(maturity => 
                    retryRequest(() => 
                        contract.fixedPools(maturity)
                            .then(pool => ({
                                maturity,
                                pool
                            }))
                    , 5, 2000)
                );

                const pools = await Promise.all(poolPromises);
                const fixedPools = pools
                    .filter(p => p !== null)  // Only filter out failed requests
                    .map(({ maturity, pool }) => ({
                        maturity,
                        depositsRaw: Number(ethers.utils.formatUnits(pool.supplied, decimals)),
                        borrowsRaw: Number(ethers.utils.formatUnits(pool.borrowed, decimals)),
                        unassignedEarningsRaw: Number(ethers.utils.formatUnits(pool.unassignedEarnings, decimals)),
                        deposits: formatFromWei(pool.supplied, decimals),
                        borrows: formatFromWei(pool.borrowed, decimals),
                        unassignedEarnings: formatFromWei(pool.unassignedEarnings, decimals)
                    }))
                    .sort((a, b) => a.maturity - b.maturity);

                return {
                    name: `${symbol} Market`,
                    symbol,
                    floatingDepositsRaw: Number(ethers.utils.formatUnits(floatingAssets, decimals)),
                    floatingBorrowsRaw: Number(ethers.utils.formatUnits(totalFloatingBorrowAssets, decimals)),
                    floatingDeposits: formatFromWei(floatingAssets, decimals),
                    floatingBorrows: formatFromWei(totalFloatingBorrowAssets, decimals),
                    fixedPools
                };
            } catch (error) {
                console.error(`Error fetching data for ${symbol} market:`, error);
                return null;
            }
        });

        const results = await Promise.all(marketPromises);
        markets.push(...results.filter(market => market !== null));
        
        if (markets.length === 0) {
            throw new Error('No market data could be fetched');
        }
        
        console.log('Successfully fetched data for', markets.length, 'markets');
        return { markets };
    } catch (error) {
        console.error('Error in fetchMarketData:', error);
        throw error;
    }
}

// Render the markets
async function renderMarkets() {
    const marketsContainer = document.getElementById('markets');
    if (!marketsContainer) {
        console.error('Markets container not found');
        return;
    }

    marketsContainer.innerHTML = '<div class="loading">Loading markets data...</div>';

    try {
        const data = await fetchMarketData();
        console.log('Received market data:', data);
        
        if (!data || !data.markets || data.markets.length === 0) {
            throw new Error('No market data available');
        }

        // Store current market data for CSV export
        currentMarketData = data;

        marketsContainer.innerHTML = '';
        data.markets.forEach(market => {
            const marketCard = createMarketCard(market);
            marketsContainer.appendChild(marketCard);
        });
    } catch (error) {
        console.error('Error in renderMarkets:', error);
        marketsContainer.innerHTML = `
            <div class="error">
                Error loading market data: ${error.message}
            </div>
        `;
    }
}

// Function to escape CSV values
function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}

// Function to generate CSV content
function generateCsvContent(markets) {
    // CSV Headers
    const headers = [
        'Market',
        'Floating Deposits',
        'Floating Borrows',
        'Pool Maturity',
        'Pool Deposits',
        'Pool Borrows',
        'Pool Pending Interests'
    ].map(escapeCSV).join(',');

    const rows = markets.flatMap(market => {
        const marketFloatingDeposits = displayValue(market.symbol, market.floatingDepositsRaw, market.floatingDeposits);
        const marketFloatingBorrows = displayValue(market.symbol, market.floatingBorrowsRaw, market.floatingBorrows);

        if (!market.fixedPools || market.fixedPools.length === 0) {
            return [[
                escapeCSV(market.symbol),
                escapeCSV(marketFloatingDeposits),
                escapeCSV(marketFloatingBorrows),
                '', '', '', ''
            ].join(',')];
        }
        return market.fixedPools.map(pool => {
            const maturityDate = formatMaturityDate(pool.maturity);
            const poolDeposits = displayValue(market.symbol, pool.depositsRaw, pool.deposits);
            const poolBorrows = displayValue(market.symbol, pool.borrowsRaw, pool.borrows);
            const poolPending = displayValue(market.symbol, pool.unassignedEarningsRaw, pool.unassignedEarnings);
            const row = [
                escapeCSV(market.symbol),
                escapeCSV(marketFloatingDeposits),
                escapeCSV(marketFloatingBorrows),
                escapeCSV(maturityDate),
                escapeCSV(poolDeposits),
                escapeCSV(poolBorrows),
                escapeCSV(poolPending)
            ];
            return row.join(',');
        });
    });

    return [headers, ...rows].join('\n');
}

// Function to download CSV
function downloadCsv() {
    if (!currentMarketData || !currentMarketData.markets) {
        console.error('No market data available for CSV export');
        return;
    }

    const csvContent = generateCsvContent(currentMarketData.markets);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `exa-markets-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Add event listener for CSV download
document.addEventListener('DOMContentLoaded', () => {
    const marketsContainer = document.getElementById('markets');
    if (marketsContainer) {
        marketsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 24px;
            gap: 24px;
            background: #f5f5f5;
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        `;
    }

    // Pre-load asset prices for USD conversion
    fetchAssetPrices().then(prices => {
        assetPrices = prices;
    }).catch(error => console.error("Error preloading asset prices:", error));

    // Add click handler for CSV download button
    const downloadButton = document.getElementById('downloadCsv');
    if (downloadButton) {
        downloadButton.addEventListener('click', downloadCsv);
    }

    // Toggle button for switching between asset and USD display
    const toggleButton = document.getElementById('toggleDisplay');
    if (toggleButton) {
        toggleButton.addEventListener('click', async () => {
            useUsd = !useUsd;
            toggleButton.innerText = useUsd ? "Switch to Asset Denomination" : "Switch to USD Denomination";
            if (useUsd && (!assetPrices)) {
                try {
                    assetPrices = await fetchAssetPrices();
                } catch (error) {
                    console.error("Error fetching asset prices:", error);
                }
            }
            renderMarkets();
        });
    }

    console.log('DOM loaded, starting to fetch market data...');
    renderMarkets();
}); 
