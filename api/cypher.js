import neo4j from 'neo4j-driver';

let driver = null;

function getDriver() {
  const uri = process.env.NEO4J_URI || process.env.VITE_NEO4J_URI;
  const user = process.env.NEO4J_USER || process.env.NEO4J_USERNAME || process.env.VITE_NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD || process.env.VITE_NEO4J_PASSWORD;

  if (!driver && uri && password) {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

function serializeNeo4jValue(val) {
  if (val === null || val === undefined) return val;
  if (neo4j.isInt(val)) return val.toNumber();
  if (Array.isArray(val)) return val.map(serializeNeo4jValue);
  if (typeof val === 'object') {
    if (val.year !== undefined && val.month !== undefined && val.day !== undefined) {
      const y = neo4j.isInt(val.year) ? val.year.toNumber() : val.year;
      const m = neo4j.isInt(val.month) ? val.month.toNumber() : val.month;
      const d = neo4j.isInt(val.day) ? val.day.toNumber() : val.day;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    if (val.labels && val.properties) {
      const props = serializeNeo4jValue(val.properties);
      return { ...props, _labels: val.labels };
    }
    if (val.type && val.properties !== undefined) {
      const props = serializeNeo4jValue(val.properties);
      return { ...props, type: val.type, _type: val.type };
    }
    const res = {};
    for (const key of Object.keys(val)) {
      res[key] = serializeNeo4jValue(val[key]);
    }
    return res;
  }
  return val;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query, params } = req.body || {};
  if (!query) {
    return res.status(400).json({ error: 'Query string is required' });
  }

  const drv = getDriver();
  if (!drv) {
    return res.status(500).json({ error: 'Database credentials not configured on server' });
  }

  const database = process.env.NEO4J_DATABASE || process.env.VITE_NEO4J_DATABASE || 'neo4j';
  const session = drv.session({ database });

  try {
    const startTime = Date.now();
    const result = await session.run(query, params || {});
    const duration = Date.now() - startTime;
    const columns = result.records.length > 0 ? result.records[0].keys : [];
    const rows = result.records.map(record => {
      const row = {};
      record.keys.forEach(k => {
        row[k] = serializeNeo4jValue(record.get(k));
      });
      return row;
    });

    return res.status(200).json({ columns, rows, duration });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
}
