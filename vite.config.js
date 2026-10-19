import { defineConfig, loadEnv } from 'vite';
import neo4j from 'neo4j-driver';

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const uri = env.NEO4J_URI || env.VITE_NEO4J_URI;
  const user = env.NEO4J_USER || env.NEO4J_USERNAME || env.VITE_NEO4J_USER;
  const password = env.NEO4J_PASSWORD || env.VITE_NEO4J_PASSWORD;
  const database = env.NEO4J_DATABASE || env.VITE_NEO4J_DATABASE || 'neo4j';

  let driver = null;
  function getDriver() {
    if (!driver && uri && password) {
      try {
        driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
      } catch (e) {
        console.error('Neo4j driver init error:', e.message);
      }
    }
    return driver;
  }

  return {
    server: {
      port: 5173
    },
    plugins: [
      {
        name: 'dev-api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url === '/api/health') {
              const drv = getDriver();
              if (!drv) {
                res.statusCode = 503;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ connected: false, error: 'Driver uninitialized' }));
                return;
              }

              const session = drv.session({ database });
              try {
                const r = await session.run('RETURN 1 AS ok, datetime() AS time');
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ connected: true, time: r.records[0].get('time').toString(), database }));
              } catch (err) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ connected: false, error: err.message }));
              } finally {
                await session.close();
              }
              return;
            }

            if (req.url === '/api/cypher') {
              if (req.method !== 'POST') {
                res.statusCode = 405;
                res.end(JSON.stringify({ error: 'Method not allowed' }));
                return;
              }

              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', async () => {
                try {
                  const { query, params } = JSON.parse(body || '{}');
                  const drv = getDriver();
                  if (!drv) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Neo4j driver not initialized. Check server env vars.' }));
                    return;
                  }

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

                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ columns, rows, duration }));
                  } finally {
                    await session.close();
                  }
                } catch (err) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: err.message }));
                }
              });
              return;
            }

            next();
          });
        }
      }
    ]
  };
});
