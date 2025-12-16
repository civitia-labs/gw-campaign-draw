import fs from 'fs';
import csv from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import https from 'https';

// Prize tier configuration
const PRIZE_TIERS = [
  { name: 'Grand Prize', winners: 5, initPerWinner: 2500 },
  { name: 'Major Prize', winners: 20, initPerWinner: 1125 },
  { name: 'Minor Prize', winners: 50, initPerWinner: 300 },
] as const;

interface SnapshotEntry {
  address: string;
  init_spent: string;
}

interface PlayerEntry {
  address: string;
  initSpent: number;
  tickets: number;
}

interface DrawResult {
  address: string;
  init_spent: number;
  tickets: number;
  prize_tier: string;
  init_won: number;
}

interface NISTBeaconResponse {
  pulse: {
    outputValue: string;
    timeStamp: string;
  };
}

// Load snapshot data from CSV
function loadSnapshotData(filePath: string): PlayerEntry[] {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const records = csv.parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  }) as SnapshotEntry[];

  return records.map((entry) => {
    const initSpent = parseFloat(entry.init_spent);
    const tickets = Math.floor(initSpent / 100); // 1 ticket per 100 INIT
    return {
      address: entry.address,
      initSpent,
      tickets,
    };
  });
}

// Fetch NIST randomness beacon
async function fetchNISTRandomness(unixTime: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://beacon.nist.gov/beacon/2.0/pulse/time/${unixTime}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response: NISTBeaconResponse = JSON.parse(data);
          console.log(`NIST Beacon timestamp: ${response.pulse.timeStamp}`);
          console.log(`NIST Beacon output: ${response.pulse.outputValue.substring(0, 64)}...`);
          resolve(response.pulse.outputValue);
        } catch (e) {
          reject(new Error(`Failed to parse NIST response: ${e}`));
        }
      });
    }).on('error', reject);
  });
}

// Simple seeded PRNG (Mulberry32)
function createSeededRandom(seed: string): () => number {
  // Convert hex string to a 32-bit seed
  let hashValue = 0;
  for (let i = 0; i < seed.length; i++) {
    hashValue = ((hashValue << 5) - hashValue + seed.charCodeAt(i)) | 0;
  }
  
  return function() {
    let t = hashValue += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Weighted random selection without replacement
function weightedRandomDraw(
  players: PlayerEntry[],
  count: number,
  random: () => number
): PlayerEntry[] {
  const winners: PlayerEntry[] = [];
  const remaining = [...players];

  for (let i = 0; i < count && remaining.length > 0; i++) {
    // Calculate total weight of remaining players
    const totalTickets = remaining.reduce((sum, p) => sum + p.tickets, 0);
    
    if (totalTickets === 0) {
      console.warn('No more players with tickets available');
      break;
    }

    // Pick a random ticket
    const randomTicket = Math.floor(random() * totalTickets);
    
    // Find the winner
    let cumulative = 0;
    let winnerIndex = -1;
    
    for (let j = 0; j < remaining.length; j++) {
      cumulative += remaining[j].tickets;
      if (randomTicket < cumulative) {
        winnerIndex = j;
        break;
      }
    }

    if (winnerIndex >= 0) {
      winners.push(remaining[winnerIndex]);
      remaining.splice(winnerIndex, 1); // Remove winner from pool
    }
  }

  return winners;
}

// Conduct the draw
async function conductDraw(
  players: PlayerEntry[],
  nistRandomness: string
): Promise<Map<string, { tier: string; amount: number }>> {
  const random = createSeededRandom(nistRandomness);
  const results = new Map<string, { tier: string; amount: number }>();
  
  // Filter players with at least 1 ticket
  let eligiblePlayers = players.filter((p) => p.tickets > 0);
  
  console.log(`\nTotal eligible players (with tickets): ${eligiblePlayers.length}`);
  console.log(`Total tickets in pool: ${eligiblePlayers.reduce((sum, p) => sum + p.tickets, 0)}\n`);

  // Draw winners for each tier (in order: Grand -> Major -> Minor)
  for (const tier of PRIZE_TIERS) {
    console.log(`Drawing ${tier.winners} winners for ${tier.name} (${tier.initPerWinner} INIT each)...`);
    
    const winners = weightedRandomDraw(eligiblePlayers, tier.winners, random);
    
    for (const winner of winners) {
      results.set(winner.address, {
        tier: tier.name,
        amount: tier.initPerWinner,
      });
      // Remove winner from eligible pool (a player can only win once)
      eligiblePlayers = eligiblePlayers.filter((p) => p.address !== winner.address);
    }
    
    console.log(`  Selected ${winners.length} winners`);
  }

  return results;
}

// Generate output CSV
function generateOutput(
  players: PlayerEntry[],
  results: Map<string, { tier: string; amount: number }>,
  outputPath: string
): void {
  const output: DrawResult[] = players.map((player) => {
    const result = results.get(player.address);
    return {
      address: player.address,
      init_spent: player.initSpent,
      tickets: player.tickets,
      prize_tier: result?.tier ?? '',
      init_won: result?.amount ?? 0,
    };
  });

  // Sort: winners first (by prize amount desc), then non-winners
  output.sort((a, b) => {
    if (a.init_won !== b.init_won) return b.init_won - a.init_won;
    return b.tickets - a.tickets;
  });

  const csvString = stringify(output, {
    header: true,
    columns: ['address', 'init_spent', 'tickets', 'prize_tier', 'init_won'],
  });

  fs.writeFileSync(outputPath, csvString);
  console.log(`\nResults saved to: ${outputPath}`);
}

// Print summary
function printSummary(
  players: PlayerEntry[],
  results: Map<string, { tier: string; amount: number }>
): void {
  console.log('\n=== DRAW SUMMARY ===\n');
  
  const totalPlayers = players.length;
  const playersWithTickets = players.filter((p) => p.tickets > 0).length;
  const totalTickets = players.reduce((sum, p) => sum + p.tickets, 0);
  
  console.log(`Total players: ${totalPlayers}`);
  console.log(`Players with tickets: ${playersWithTickets}`);
  console.log(`Total tickets: ${totalTickets}`);
  
  let totalDistributed = 0;
  
  for (const tier of PRIZE_TIERS) {
    const tierWinners = Array.from(results.entries())
      .filter(([_, r]) => r.tier === tier.name);
    const tierTotal = tierWinners.reduce((sum, [_, r]) => sum + r.amount, 0);
    totalDistributed += tierTotal;
    
    console.log(`\n${tier.name}:`);
    console.log(`  Winners: ${tierWinners.length} / ${tier.winners}`);
    console.log(`  INIT distributed: ${tierTotal.toLocaleString()}`);
  }
  
  console.log(`\nTotal INIT distributed: ${totalDistributed.toLocaleString()}`);
}

// Main execution
async function main() {
  const inputPath = process.argv[2] || 'snapshot.csv';
  const outputPath = process.argv[3] || 'draw_results.csv';
  const unixTime = process.argv[4] ? parseInt(process.argv[4]) : 1765881000000;

  console.log(`Input file: ${inputPath}`);
  console.log(`Output file: ${outputPath}`);
  console.log(`NIST timestamp: ${unixTime}`);
  
  // Load player data
  const players = loadSnapshotData(inputPath);
  console.log(`\nLoaded ${players.length} players from snapshot`);
  
  // Fetch NIST randomness
  console.log('\nFetching NIST randomness beacon...');
  const nistRandomness = await fetchNISTRandomness(unixTime);
  
  // Conduct the draw
  const results = await conductDraw(players, nistRandomness);
  
  // Generate output
  generateOutput(players, results, outputPath);
  
  // Print summary
  printSummary(players, results);
}

main().catch(console.error);

