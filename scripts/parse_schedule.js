/*
Parse daily schedule PDFs in ./schedule and output Jeju-bound flights to ./public/mock/jeju-schedule.json
- Filters lines mentioning Jeju (제주|JEJU|CJU|RKPC)
- Origins limited to RKSS, RKTU, RKJK, RKJJ
- Extracts EOBT (HH:MM), callsign (AA1234), and aircraft type (A320/B738/...)
*/

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const SCHEDULE_DIR = path.resolve(__dirname, '../schedule');
const OUTPUT_FILE = path.resolve(__dirname, '../public/mock/jeju-schedule.json');

const JEJU_REGEX = /(제주|JEJU|CJU|RKPC)/i;
const ORIGIN_REGEX = /(RKSS|RKTU|RKJK|RKJJ)/;
const TIME_REGEX = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
const TYPE_REGEX = /\b(A3(?:18|19|20|21)|A220|B7(?:37|38|39)|B73M|B39M|B739|B738|B737|E19(?:0|5)|E175|E170|ATR72|DH8D)\b/;
const CALLSIGN_REGEX = /\b([A-Z0-9]{2,3}\d{3,4})\b/;

// KST를 UTC로 변환 (KST = UTC + 9)
function kstToUtc(kstTimeStr) {
  const [hours, minutes] = kstTimeStr.split(':').map(Number);
  let utcHours = hours - 9;
  let utcMinutes = minutes;
  
  if (utcHours < 0) {
    utcHours += 24;
  }
  
  return `${utcHours.toString().padStart(2, '0')}:${utcMinutes.toString().padStart(2, '0')}`;
}

async function parsePdfFile(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  const text = data.text || '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const flights = [];
  for (const line of lines) {
    if (!JEJU_REGEX.test(line)) continue;
    const originMatch = line.match(ORIGIN_REGEX);
    if (!originMatch) continue;

    // 모든 시간 매칭 찾기 (출발시간, 도착시간 등)
    const timeMatches = [...line.matchAll(TIME_REGEX)];
    const typeMatch = line.match(TYPE_REGEX);
    const callsignMatch = line.match(CALLSIGN_REGEX);

    const origin = originMatch[1];
    
    // 첫 번째 시간을 출발시간(EOBT)으로 사용
    const kstEobt = timeMatches.length > 0 ? timeMatches[0][0] : null;
    if (!kstEobt) continue;
    
    // KST를 UTC로 변환
    const utcEobt = kstToUtc(kstEobt);
    const type = typeMatch ? typeMatch[0] : null;
    const callsign = callsignMatch ? callsignMatch[1] : null;

    console.log(`파싱된 항공편: ${origin} -> JEJU, EOBT: ${kstEobt} KST -> ${utcEobt} UTC, 기종: ${type || 'N/A'}, 편명: ${callsign || 'N/A'}`);

    flights.push({ 
      origin, 
      eobt: utcEobt,  // UTC 시간으로 저장
      eobtKst: kstEobt,  // 원본 KST 시간도 보관
      type: type || 'B738', 
      callsign: callsign || `${origin}${Math.floor(Math.random()*9000+1000)}`,
      destination: 'RKPC'  // 제주공항 코드 추가
    });
  }
  return flights;
}

async function run() {
  if (!fs.existsSync(SCHEDULE_DIR)) {
    console.error('Schedule directory not found:', SCHEDULE_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.warn('No PDF files found in', SCHEDULE_DIR);
  }

  const allFlights = [];
  for (const file of files) {
    const full = path.join(SCHEDULE_DIR, file);
    try {
      const flights = await parsePdfFile(full);
      console.log(`Parsed ${file}: ${flights.length} Jeju-bound flights`);
      allFlights.push(...flights);
    } catch (err) {
      console.error('Error parsing', file, err.message);
    }
  }

  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const output = { date: dateStr, flights: allFlights };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log('Wrote', OUTPUT_FILE, `(${allFlights.length} flights)`);
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
