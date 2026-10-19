// Cypher and Oracle SQL Preset Queries for Query Studio
// (All live entity data is queried dynamically from Neo4j AuraDB)

export const presetQueries = [
  {
    id: 'traversal-1',
    category: 'Graph Traversal',
    title: 'Customer Vehicle & Policy Path Traversal',
    description: 'Finds each customer along with their owned vehicle and insurance policy (Multi-hop path).',
    cypher: `MATCH (c:Customer)-[:OWNS]->(v:Vehicle)-[:INSURED_BY]->(p:Policy)
RETURN c.name AS Customer, v.brand + ' ' + v.vehicle_model AS Vehicle, v.reg_no AS Reg_No, p.policy_type AS Policy, p.policy_status AS Status
ORDER BY c.name;`,
    oracleSql: `SELECT c.Cust_Name, v.Brand || ' ' || v.Vehicle_Model, v.Reg_No, p.Policy_Type, p.Policy_Status
FROM CUSTOMER c
JOIN VEHICLE v ON c.Customer_ID = v.Customer_ID
JOIN POLICY p ON v.Vehicle_ID = p.Vehicle_ID
ORDER BY c.Cust_Name;`
  },
  {
    id: 'traversal-2',
    category: 'Graph Traversal',
    title: 'Full 4-Hop Traversal: Customer to Claim',
    description: 'Traverses 4 nodes: (Customer) -> (Vehicle) -> (Policy) -> (Claim).',
    cypher: `MATCH (c:Customer)-[:OWNS]->(v:Vehicle)-[:INSURED_BY]->(p:Policy)-[:GENERATES]->(cl:Claim)
RETURN cl.claim_id AS Claim_ID, c.name AS Customer, v.reg_no AS Vehicle, cl.claim_amount AS Amount, cl.claim_status AS Status
ORDER BY cl.claim_id;`,
    oracleSql: `SELECT cl.Claim_ID, c.Cust_Name, v.Reg_No, cl.Claim_Amount, cl.Claim_Status
FROM CLAIM cl
JOIN POLICY p ON cl.Policy_ID = p.Policy_ID
JOIN VEHICLE v ON p.Vehicle_ID = v.Vehicle_ID
JOIN CUSTOMER c ON v.Customer_ID = c.Customer_ID
ORDER BY cl.Claim_ID;`
  },
  {
    id: 'aggregation-1',
    category: 'Aggregations',
    title: 'Brand Distribution & Vehicle Counts',
    description: 'Groups vehicles by manufacturer brand and counts registered models.',
    cypher: `MATCH (v:Vehicle)
RETURN v.brand AS Brand, count(v) AS Total_Vehicles
ORDER BY Total_Vehicles DESC, Brand;`,
    oracleSql: `SELECT Brand, COUNT(*) AS Total_Vehicles 
FROM VEHICLE 
GROUP BY Brand 
ORDER BY Total_Vehicles DESC, Brand;`
  },
  {
    id: 'aggregation-2',
    category: 'Aggregations',
    title: 'Policy Type Summary: Count & Total Premium',
    description: 'Calculates total and average premium per policy category.',
    cypher: `MATCH (p:Policy)
RETURN p.policy_type AS Policy_Type, count(p) AS Policies, sum(p.premium_amount) AS Total_Premium, round(avg(p.premium_amount), 2) AS Avg_Premium
ORDER BY Total_Premium DESC;`,
    oracleSql: `SELECT Policy_Type, COUNT(*) AS Policies, SUM(Premium_Amount) AS Total_Premium, ROUND(AVG(Premium_Amount), 2) AS Avg_Premium
FROM POLICY
GROUP BY Policy_Type
ORDER BY Total_Premium DESC;`
  },
  {
    id: 'pattern-1',
    category: 'Pattern Matching',
    title: 'Uninsured Vehicles (OPTIONAL MATCH / Left Join)',
    description: 'Finds vehicles that currently do not have any active insurance policy.',
    cypher: `MATCH (v:Vehicle)
WHERE NOT (v)-[:INSURED_BY]->(:Policy)
RETURN v.vehicle_id AS ID, v.reg_no AS Reg_No, v.brand AS Brand, v.vehicle_model AS Model;`,
    oracleSql: `SELECT v.Vehicle_ID, v.Reg_No, v.Brand, v.Vehicle_Model
FROM VEHICLE v
WHERE NOT EXISTS (SELECT 1 FROM POLICY p WHERE p.Vehicle_ID = v.Vehicle_ID);`
  },
  {
    id: 'pattern-2',
    category: 'Pattern Matching',
    title: 'Outstanding Premium Balance per Policy',
    description: 'Calculates premium remaining after aggregating all recorded payments.',
    cypher: `MATCH (p:Policy)
OPTIONAL MATCH (p)-[:PAID_THROUGH]->(pay:Payment)
WITH p, coalesce(sum(pay.amount), 0) AS Paid
WHERE p.premium_amount > Paid
RETURN p.policy_id AS Policy_ID, p.premium_amount AS Premium, Paid, (p.premium_amount - Paid) AS Balance;`,
    oracleSql: `SELECT p.Policy_ID, p.Premium_Amount, NVL(SUM(pay.Amount), 0) AS Paid, p.Premium_Amount - NVL(SUM(pay.Amount), 0) AS Balance
FROM POLICY p
LEFT JOIN PAYMENT pay ON p.Policy_ID = pay.Policy_ID
GROUP BY p.Policy_ID, p.Premium_Amount
HAVING p.Premium_Amount > NVL(SUM(pay.Amount), 0);`
  },
  {
    id: 'team-query',
    category: 'Project Special',
    title: 'Team Members Insurance Portfolio',
    description: 'Extracts vehicles, policies, and claims for Vinayak, Dhruv, and Arnav.',
    cypher: `MATCH (c:Customer)-[:OWNS]->(v:Vehicle)
WHERE c.name IN ['Vinayak Tripathi', 'Dhruv Upadhyaya', 'Arnav Singla']
OPTIONAL MATCH (v)-[:INSURED_BY]->(p:Policy)
OPTIONAL MATCH (p)-[:GENERATES]->(cl:Claim)
RETURN c.name AS Member, v.brand + ' ' + v.vehicle_model AS Vehicle, v.reg_no AS Reg_No, coalesce(p.policy_status, 'None') AS Policy_Status, coalesce(cl.claim_status, 'No Claim') AS Claim_Status
ORDER BY c.name;`,
    oracleSql: `SELECT c.Cust_Name, v.Reg_No, v.Brand || ' ' || v.Vehicle_Model AS Vehicle, p.Policy_ID, p.Policy_Status, cl.Claim_ID, cl.Claim_Status
FROM CUSTOMER c
JOIN VEHICLE v ON c.Customer_ID = v.Customer_ID
LEFT JOIN POLICY p ON v.Vehicle_ID = p.Vehicle_ID
LEFT JOIN CLAIM cl ON p.Policy_ID = cl.Policy_ID
WHERE c.Cust_Name IN ('Vinayak Tripathi', 'Dhruv Upadhyaya', 'Arnav Singla')
ORDER BY c.Cust_Name;`
  }
];
