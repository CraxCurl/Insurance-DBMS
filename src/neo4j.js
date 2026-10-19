import neo4j from 'neo4j-driver';

let clientDriver = null;

export function getNeo4jConfig() {
  return {
    uri: localStorage.getItem('neo4j_uri') || import.meta.env.VITE_NEO4J_URI || '',
    user: localStorage.getItem('neo4j_user') || import.meta.env.VITE_NEO4J_USER || '',
    password: localStorage.getItem('neo4j_password') || import.meta.env.VITE_NEO4J_PASSWORD || '',
    database: localStorage.getItem('neo4j_database') || import.meta.env.VITE_NEO4J_DATABASE || 'neo4j'
  };
}

export function saveNeo4jConfig(config) {
  if (config.uri) localStorage.setItem('neo4j_uri', config.uri);
  if (config.user) localStorage.setItem('neo4j_user', config.user);
  if (config.password) localStorage.setItem('neo4j_password', config.password);
  if (config.database) localStorage.setItem('neo4j_database', config.database);
  if (clientDriver) {
    clientDriver.close().catch(() => {});
    clientDriver = null;
  }
}

function getClientDriver() {
  const config = getNeo4jConfig();
  if (!config.uri || !config.password) return null;

  if (!clientDriver) {
    try {
      clientDriver = neo4j.driver(
        config.uri,
        neo4j.auth.basic(config.user, config.password),
        {
          maxConnectionLifetime: 3 * 60 * 60 * 1000,
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 5000
        }
      );
    } catch (e) {
      console.error('Client driver init failed:', e);
      return null;
    }
  }
  return clientDriver;
}

// Test Connection (tries serverless /api/health first, falls back to direct client driver)
export async function testConnection() {
  // 1. Try serverless endpoint
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const data = await res.json();
      if (data.connected) return { connected: true, via: 'server', time: data.time };
    }
  } catch {
    // server API not available, proceed to direct client check
  }

  // 2. Direct client driver
  const drv = getClientDriver();
  if (!drv) {
    return { connected: false, reason: 'No database credentials configured.' };
  }

  const session = drv.session({ database: getNeo4jConfig().database });
  try {
    const r = await session.run('RETURN 1 AS ok, datetime() AS time');
    return { connected: true, via: 'client', time: r.records[0].get('time').toString() };
  } catch (err) {
    return { connected: false, reason: err.message };
  } finally {
    await session.close();
  }
}

// Run Cypher (tries serverless /api/cypher first, falls back to client driver)
export async function runCypher(query, params = {}) {
  // 1. Try serverless API
  try {
    const res = await fetch('/api/cypher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, params })
    });
    if (res.ok) {
      const data = await res.json();
      return {
        columns: data.columns || [],
        rows: data.rows || [],
        duration: data.duration || 0,
        via: 'server'
      };
    }
  } catch {
    // server API failed, fallback to client driver
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

  // 2. Fallback to direct client driver
  const drv = getClientDriver();
  if (!drv) {
    throw new Error('Neo4j database connection unavailable. Check environment variables or Settings.');
  }

  const session = drv.session({ database: getNeo4jConfig().database });
  const start = performance.now();
  try {
    const result = await session.run(query, params);
    const duration = Math.round(performance.now() - start);
    const columns = result.records.length > 0 ? result.records[0].keys : [];
    const rows = result.records.map(record => {
      const row = {};
      record.keys.forEach(k => {
        row[k] = serializeNeo4jValue(record.get(k));
      });
      return row;
    });

    return { columns, rows, duration, via: 'client' };
  } finally {
    await session.close();
  }
}

// Fetch live graph neighborhood for focused exploration
export async function fetchFocusedGraph(label, idProperty, idValue) {
  let query = '';
  let params = { val: idValue };

  if (label && idProperty && idValue !== undefined) {
    query = `
      MATCH (n:${label} {${idProperty}: $val})
      OPTIONAL MATCH (n)-[r]-(m)
      RETURN n, r, m
      LIMIT 25;
    `;
  } else {
    // Default initial seed: 3 sample customers and their immediate neighbors
    query = `
      MATCH (c:Customer)
      WITH c LIMIT 3
      OPTIONAL MATCH (c)-[r1:OWNS]->(v:Vehicle)
      OPTIONAL MATCH (v)-[r2:INSURED_BY]->(p:Policy)
      RETURN c AS n, r1 AS r, v AS m
      LIMIT 20;
    `;
    params = {};
  }

  const res = await runCypher(query, params);
  return parseGraphRecords(res.rows);
}

// Expand neighbors of a selected node
export async function expandNeighbors(nodeType, idProperty, idValue) {
  const query = `
    MATCH (n:${nodeType} {${idProperty}: $val})-[r]-(m)
    RETURN n, r, m
    LIMIT 30;
  `;
  const res = await runCypher(query, { val: idValue });
  return parseGraphRecords(res.rows);
}

// Helper to convert raw Neo4j rows into nodes and links
function parseGraphRecords(rows) {
  const nodeMap = new Map();
  const links = [];

  rows.forEach(row => {
    const n = row.n;
    const m = row.m;
    const r = row.r;

    if (n) addNodeToMap(n, nodeMap);
    if (m) addNodeToMap(m, nodeMap);

    if (r && n && m) {
      const sourceId = getNodeKey(n);
      const targetId = getNodeKey(m);
      links.push({
        source: sourceId,
        target: targetId,
        label: r.type || 'RELATED_TO'
      });
    }
  });

  return {
    nodes: Array.from(nodeMap.values()),
    links
  };
}

function getNodeKey(node) {
  if (node.customer_id) return `Customer_${node.customer_id}`;
  if (node.vehicle_id) return `Vehicle_${node.vehicle_id}`;
  if (node.policy_id) return `Policy_${node.policy_id}`;
  if (node.claim_id) return `Claim_${node.claim_id}`;
  if (node.payment_id) return `Payment_${node.payment_id}`;
  if (node.doc_no) return `Doc_${node.doc_no}`;
  if (node.image_no) return `Img_${node.image_no}`;
  if (node.receipt_no) return `Receipt_${node.receipt_no}`;
  return `Node_${Math.random().toString(36).substr(2, 6)}`;
}

function addNodeToMap(node, map) {
  const key = getNodeKey(node);
  if (map.has(key)) return;

  let type = 'Node';
  let title = 'Entity';
  let color = '#888888';

  if (node.customer_id) {
    type = 'Customer';
    title = node.name || `Customer #${node.customer_id}`;
    color = '#10b981'; // Green
  } else if (node.vehicle_id) {
    type = 'Vehicle';
    title = node.reg_no || `Vehicle #${node.vehicle_id}`;
    color = '#0ea5e9'; // Blue
  } else if (node.policy_id) {
    type = 'Policy';
    title = `Policy #${node.policy_id}`;
    color = '#6366f1'; // Indigo
  } else if (node.claim_id) {
    type = 'Claim';
    title = `Claim #${node.claim_id}`;
    color = '#f43f5e'; // Rose
  } else if (node.payment_id) {
    type = 'Payment';
    title = `Payment #${node.payment_id}`;
    color = '#a855f7'; // Purple
  } else if (node.doc_no) {
    type = 'ClaimDocument';
    title = `Doc #${node.doc_no} (${node.doc_type || ''})`;
    color = '#f59e0b';
  } else if (node.image_no) {
    type = 'VehicleImage';
    title = `Image #${node.image_no}`;
    color = '#f59e0b';
  } else if (node.receipt_no) {
    type = 'PaymentReceipt';
    title = `Receipt #${node.receipt_no}`;
    color = '#f59e0b';
  }

  map.set(key, {
    id: key,
    type,
    label: title,
    color,
    radius: type === 'Customer' ? 18 : type === 'Vehicle' ? 16 : 14,
    data: node,
    x: Math.random() * 600 + 100,
    y: Math.random() * 400 + 100,
    vx: 0,
    vy: 0
  });
}
