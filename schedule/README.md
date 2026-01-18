# Schedule PDFs

Drop daily schedule PDFs in this folder. The parser looks for lines mentioning Jeju-bound flights and extracts:
- Origin: one of RKSS (Gimpo), RKTU (Cheongju), RKJK (Gunsan), RKJJ (Gwangju)
- Destination markers: 제주 / JEJU / CJU / RKPC
- EOBT time: HH:MM (treated as UTC in the app)
- Aircraft type: A320, B738, B737, A321, etc. (optional)
- Callsign/Flight number: e.g., KE1234, 7C123, LJ456 (optional)

Output is written to `public/mock/jeju-schedule.json`.

Run the parser:

```
npm install
npm run parse:schedule
```

If no PDFs are present, the output will be an empty `flights` array, and the app will fallback to random mock data.
