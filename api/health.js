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

export default async function handler(req, res) {
  const drv = getDriver();
  if (!drv) {
    return res.status(503).json({ connected: false, error: 'Neo4j credentials not configured' });
  }

  const database = process.env.NEO4J_DATABASE || process.env.VITE_NEO4J_DATABASE || 'neo4j';
  const session = drv.session({ database });

  try {
    const result = await session.run('RETURN 1 AS ok, datetime() AS time');
    return res.status(200).json({
      connected: true,
      time: result.records[0].get('time').toString(),
      database
    });
  } catch (err) {
    return res.status(500).json({ connected: false, error: err.message });
  } finally {
    await session.close();
  }
}
