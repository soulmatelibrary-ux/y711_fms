/**
 * 데이터베이스 관리 (SQLite)
 */

let db = null;
let sqlJs = null;

export async function initDatabase() {
    try {
        if (typeof window.initSqlJs === 'undefined') {
            console.error('sql.js not loaded');
            throw new Error('sql.js not available');
        }

        sqlJs = await window.initSqlJs({
            locateFile: file => `/${file}`
        });

        console.log('✅ sql.js initialized');

        // Create fresh database (cache disabled)
        db = new sqlJs.Database();
        console.log('✅ New database created (cache disabled)');

        // Create tables
        createTables();

        return db;

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}

function createTables() {
    if (!db) return;

    db.run(`
        CREATE TABLE IF NOT EXISTS flights (
            id TEXT PRIMARY KEY,
            user_id VARCHAR(50),
            callsign TEXT,
            dept TEXT,
            dest TEXT,
            cfl TEXT,
            eobt_utc TEXT,
            day_of_week INTEGER,
            uploaded_date TEXT,
            schedule_start_date TEXT,
            schedule_end_date TEXT,
            uploaded_by VARCHAR(50),
            uploaded_at TIMESTAMP,
            uploaded_session_id TEXT,
            is_editable BOOLEAN DEFAULT 1,
            is_deletable BOOLEAN DEFAULT 1
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS ctot_calculations (
            id TEXT PRIMARY KEY,
            user_id VARCHAR(50),
            flight_id TEXT,
            calculated_ctot TEXT,
            delay_minutes INTEGER,
            separation_rule INTEGER,
            status VARCHAR(20),
            calculated_at TIMESTAMP,
            modified_at TIMESTAMP,
            modified_by VARCHAR(50)
        )
    `);

    // Migration: Add columns if they don't exist
    const migrations = [
        'ALTER TABLE flights ADD COLUMN user_id VARCHAR(50)',
        'ALTER TABLE flights ADD COLUMN schedule_start_date TEXT',
        'ALTER TABLE flights ADD COLUMN schedule_end_date TEXT',
        'ALTER TABLE flights ADD COLUMN uploaded_by VARCHAR(50)',
        'ALTER TABLE flights ADD COLUMN uploaded_at TIMESTAMP',
        'ALTER TABLE flights ADD COLUMN uploaded_session_id TEXT',
        'ALTER TABLE flights ADD COLUMN is_editable BOOLEAN DEFAULT 1',
        'ALTER TABLE flights ADD COLUMN is_deletable BOOLEAN DEFAULT 1'
    ];

    migrations.forEach(migration => {
        try {
            db.run(migration);
        } catch (e) {
            // Column already exists
        }
    });
}

export function getDatabase() {
    return db;
}

export function saveDatabase() {
    // localStorage cache disabled
    // Each session starts with fresh database
    console.log('Database auto-save disabled (fresh DB on each load)');
}

export function queryFlights(userId = null) {
    if (!db) return [];

    let query = 'SELECT * FROM flights';
    const params = [];

    if (userId) {
        query += ' WHERE user_id = ?';
        params.push(userId);
    }

    try {
        const result = db.exec(query, params);
        if (result.length > 0 && result[0].values.length > 0) {
            return result[0].values.map(row => ({
                id: row[0],
                user_id: row[1],
                callsign: row[2],
                dept: row[3],
                dest: row[4],
                cfl: row[5],
                eobt_utc: row[6],
                day_of_week: row[7],
                uploaded_date: row[8],
                schedule_start_date: row[9],
                schedule_end_date: row[10],
                uploaded_by: row[11],
                uploaded_at: row[12],
                uploaded_session_id: row[13],
                is_editable: row[14],
                is_deletable: row[15]
            }));
        }
        return [];
    } catch (error) {
        console.error('Error querying flights:', error);
        return [];
    }
}

export function insertFlights(flightsData, userId, userName, scheduleStartDate, scheduleEndDate) {
    if (!db) return 0;

    const timestamp = Date.now();
    const uploadSessionId = Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();
    const uploadDate = new Date().toISOString().split('T')[0];

    // Delete overlapping data
    if (scheduleStartDate && scheduleEndDate) {
        db.run(
            `DELETE FROM flights
             WHERE user_id = ?
             AND schedule_start_date <= ?
             AND schedule_end_date >= ?`,
            [userId, scheduleEndDate, scheduleStartDate]
        );
    }

    let insertedCount = 0;
    flightsData.forEach((flight, index) => {
        const flightId = `${uploadDate}_${index}_${timestamp}`;

        try {
            db.run(
                `INSERT INTO flights (
                    id, user_id, callsign, dept, dest, cfl, eobt_utc,
                    day_of_week, schedule_start_date, schedule_end_date,
                    uploaded_date, uploaded_by, uploaded_at, uploaded_session_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    flightId,
                    userId,
                    flight.CALLSIGN,
                    flight.DEPT,
                    flight.DEST,
                    flight.CFL,
                    flight.EOBT_UTC || flight.EOBT,
                    flight.DAY_OF_WEEK,
                    scheduleStartDate || flight.schedule_start_date,
                    scheduleEndDate || flight.schedule_end_date,
                    uploadDate,
                    userName,
                    now,
                    uploadSessionId
                ]
            );
            insertedCount++;
        } catch (error) {
            console.error('Error inserting flight:', error);
        }
    });

    saveDatabase();
    return insertedCount;
}

export function deleteFlightRecord(flightId, userId) {
    if (!db) return false;

    try {
        db.run(
            'DELETE FROM flights WHERE id = ? AND user_id = ?',
            [flightId, userId]
        );
        saveDatabase();
        return true;
    } catch (error) {
        console.error('Error deleting flight:', error);
        return false;
    }
}

export function updateFlightRecord(flightId, userId, updates) {
    if (!db) return false;

    try {
        const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updates);

        db.run(
            `UPDATE flights SET ${setClause} WHERE id = ? AND user_id = ?`,
            [...values, flightId, userId]
        );
        saveDatabase();
        return true;
    } catch (error) {
        console.error('Error updating flight:', error);
        return false;
    }
}

export function detectScheduleOverlap(startDate, endDate) {
    if (!db) return { hasOverlap: false, overlappingDates: [] };

    try {
        const result = db.exec(
            `SELECT DISTINCT schedule_start_date, schedule_end_date FROM flights
             WHERE schedule_start_date IS NOT NULL
             AND schedule_end_date IS NOT NULL
             AND schedule_start_date <= ?
             AND schedule_end_date >= ?`,
            [endDate, startDate]
        );

        if (result.length > 0 && result[0].values.length > 0) {
            const overlappingDates = result[0].values.map(row => ({
                start: row[0],
                end: row[1]
            }));
            return { hasOverlap: true, overlappingDates };
        }

        return { hasOverlap: false, overlappingDates: [] };
    } catch (error) {
        console.error('Error detecting overlap:', error);
        return { hasOverlap: false, overlappingDates: [] };
    }
}
