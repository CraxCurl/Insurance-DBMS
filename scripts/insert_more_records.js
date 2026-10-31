import neo4j from 'neo4j-driver';

const uri = process.env.VITE_NEO4J_URI;
const user = process.env.VITE_NEO4J_USER;
const password = process.env.VITE_NEO4J_PASSWORD;
const database = process.env.VITE_NEO4J_DATABASE || 'e99dbac5';

console.log(`Connecting to Neo4j AuraDB at ${uri} as ${user}...`);
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

async function insertMoreRecords() {
  const session = driver.session({ database });
  try {
    console.log('1. Checking current entity counts...');
    const preCount = await session.run('MATCH (n) RETURN labels(n)[0] AS Label, count(n) AS Total ORDER BY Label;');
    let preTotal = 0;
    preCount.records.forEach(r => {
      const lbl = r.get('Label');
      const count = r.get('Total').toNumber();
      preTotal += count;
      console.log(` - ${lbl}: ${count}`);
    });
    console.log(`Current Total Nodes: ${preTotal}`);

    console.log('\n2. Inserting 28 new primary nodes (5 Customers, 6 Vehicles, 6 Policies, 5 Claims, 6 Payments) + weak entities & relationships...');
    
    await session.run(`
      // 5 New Customers (IDs 11 to 15)
      CREATE (c11:Customer {customer_id: 11, name: 'Ramesh Nair', address: '22 Marine Drive, Mumbai', email: 'ramesh.nair@mail.com', dob: date('1987-04-16'), license_no: 'MH0120070088991', phones: ['9876500011', '9876510011']}),
             (c12:Customer {customer_id: 12, name: 'Ananya Chatterjee', address: '18 Park Street, Kolkata', email: 'ananya.c@mail.com', dob: date('1994-09-28'), license_no: 'WB0220150044552', phones: ['9876500012']}),
             (c13:Customer {customer_id: 13, name: 'Vikram Malhotra', address: '55 Banjara Hills, Hyderabad', email: 'vikram.m@mail.com', dob: date('1983-11-12'), license_no: 'TS0920050011223', phones: ['9876500013', '9876510013']}),
             (c14:Customer {customer_id: 14, name: 'Meera Joshi', address: '10 Koregaon Park, Pune', email: 'meera.joshi@mail.com', dob: date('1996-02-04'), license_no: 'MH1220180077664', phones: ['9876500014']}),
             (c15:Customer {customer_id: 15, name: 'Rohan Gupta', address: '77 MG Road, Kochi', email: 'rohan.gupta@mail.com', dob: date('1991-08-19'), license_no: 'KL0720130099885', phones: ['9876500015']})

      // 6 New Vehicles (IDs 111 to 116)
      CREATE (v111:Vehicle {vehicle_id: 111, fuel_type: 'PETROL', reg_no: 'MH01AZ4567', vehicle_model: 'Verna', brand: 'Hyundai', mfg_year: 2023, engine_no: 'ENG1011', chassis_no: 'CHS1011'}),
             (v112:Vehicle {vehicle_id: 112, fuel_type: 'DIESEL', reg_no: 'WB02BX8901', vehicle_model: 'Thar', brand: 'Mahindra', mfg_year: 2022, engine_no: 'ENG1012', chassis_no: 'CHS1012'}),
             (v113:Vehicle {vehicle_id: 113, fuel_type: 'ELECTRIC', reg_no: 'TS09CY2345', vehicle_model: 'ZS EV', brand: 'MG', mfg_year: 2024, engine_no: 'ENG1013', chassis_no: 'CHS1013'}),
             (v114:Vehicle {vehicle_id: 114, fuel_type: 'PETROL', reg_no: 'MH12DZ6789', vehicle_model: 'Seltos', brand: 'Kia', mfg_year: 2023, engine_no: 'ENG1014', chassis_no: 'CHS1014'}),
             (v115:Vehicle {vehicle_id: 115, fuel_type: 'HYBRID', reg_no: 'KL07EF1234', vehicle_model: 'Hyryder', brand: 'Toyota', mfg_year: 2024, engine_no: 'ENG1015', chassis_no: 'CHS1015'}),
             (v116:Vehicle {vehicle_id: 116, fuel_type: 'PETROL', reg_no: 'MH01GH5678', vehicle_model: 'Elevate', brand: 'Honda', mfg_year: 2023, engine_no: 'ENG1016', chassis_no: 'CHS1016'})

      // 6 New Policies (IDs 5010 to 5015)
      CREATE (p5010:Policy {policy_id: 5010, policy_type: 'COMPREHENSIVE', premium_amount: 22500, start_date: date('2026-02-15'), end_date: date('2027-02-14'), sum_insured: 850000, policy_status: 'ACTIVE'}),
             (p5011:Policy {policy_id: 5011, policy_type: 'COMPREHENSIVE', premium_amount: 29000, start_date: date('2026-03-10'), end_date: date('2027-03-09'), sum_insured: 1250000, policy_status: 'ACTIVE'}),
             (p5012:Policy {policy_id: 5012, policy_type: 'COMPREHENSIVE', premium_amount: 34000, start_date: date('2026-04-01'), end_date: date('2027-03-31'), sum_insured: 1600000, policy_status: 'ACTIVE'}),
             (p5013:Policy {policy_id: 5013, policy_type: 'OWN_DAMAGE', premium_amount: 14500, start_date: date('2026-05-18'), end_date: date('2027-05-17'), sum_insured: 700000, policy_status: 'ACTIVE'}),
             (p5014:Policy {policy_id: 5014, policy_type: 'COMPREHENSIVE', premium_amount: 26000, start_date: date('2025-10-01'), end_date: date('2026-09-30'), sum_insured: 950000, policy_status: 'EXPIRED'}),
             (p5015:Policy {policy_id: 5015, policy_type: 'THIRD_PARTY', premium_amount: 8200, start_date: date('2026-06-20'), end_date: date('2027-06-19'), sum_insured: 350000, policy_status: 'ACTIVE'})

      // 5 New Claims (IDs 7011 to 7015)
      CREATE (cl7011:Claim {claim_id: 7011, claim_date: date('2026-06-12'), claim_amount: 42000, claim_status: 'APPROVED'}),
             (cl7012:Claim {claim_id: 7012, claim_date: date('2026-07-05'), claim_amount: 88000, claim_status: 'PENDING'}),
             (cl7013:Claim {claim_id: 7013, claim_date: date('2026-08-22'), claim_amount: 160000, claim_status: 'SETTLED'}),
             (cl7014:Claim {claim_id: 7014, claim_date: date('2026-09-15'), claim_amount: 25000, claim_status: 'REJECTED'}),
             (cl7015:Claim {claim_id: 7015, claim_date: date('2026-10-02'), claim_amount: 55000, claim_status: 'PENDING'})

      // 6 New Payments (IDs 9013 to 9018)
      CREATE (pay9013:Payment {payment_id: 9013, payment_date: date('2026-02-15'), payment_method: 'UPI', amount: 11250}),
             (pay9014:Payment {payment_id: 9014, payment_date: date('2026-08-15'), payment_method: 'UPI', amount: 11250}),
             (pay9015:Payment {payment_id: 9015, payment_date: date('2026-03-10'), payment_method: 'CARD', amount: 29000}),
             (pay9016:Payment {payment_id: 9016, payment_date: date('2026-04-01'), payment_method: 'NETBANKING', amount: 17000}),
             (pay9017:Payment {payment_id: 9017, payment_date: date('2026-05-18'), payment_method: 'CARD', amount: 14500}),
             (pay9018:Payment {payment_id: 9018, payment_date: date('2026-06-20'), payment_method: 'UPI', amount: 8200})

      // Relationships: OWNS (Customer -> Vehicle)
      CREATE (c11)-[:OWNS]->(v111),
             (c11)-[:OWNS]->(v116),
             (c12)-[:OWNS]->(v112),
             (c13)-[:OWNS]->(v113),
             (c14)-[:OWNS]->(v114),
             (c15)-[:OWNS]->(v115)

      // Relationships: INSURED_BY (Vehicle -> Policy)
      CREATE (v111)-[:INSURED_BY]->(p5010),
             (v112)-[:INSURED_BY]->(p5011),
             (v113)-[:INSURED_BY]->(p5012),
             (v114)-[:INSURED_BY]->(p5013),
             (v115)-[:INSURED_BY]->(p5014),
             (v116)-[:INSURED_BY]->(p5015)

      // Relationships: GENERATES (Policy -> Claim)
      CREATE (p5010)-[:GENERATES]->(cl7011),
             (p5011)-[:GENERATES]->(cl7012),
             (p5012)-[:GENERATES]->(cl7013),
             (p5013)-[:GENERATES]->(cl7014),
             (p5015)-[:GENERATES]->(cl7015)

      // Relationships: PAID_THROUGH (Policy -> Payment)
      CREATE (p5010)-[:PAID_THROUGH]->(pay9013),
             (p5010)-[:PAID_THROUGH]->(pay9014),
             (p5011)-[:PAID_THROUGH]->(pay9015),
             (p5012)-[:PAID_THROUGH]->(pay9016),
             (p5013)-[:PAID_THROUGH]->(pay9017),
             (p5015)-[:PAID_THROUGH]->(pay9018)

      // Weak Entities: VehicleImage, ClaimDocument, PaymentReceipt
      CREATE (v111)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'JPEG', image_data: 'FFD8FFE000104A4D'}),
             (v112)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'PNG',  image_data: '89504E470D0A1A0D'}),
             (v113)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'JPEG', image_data: 'FFD8FFE000104A4E'}),
             (v114)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'JPEG', image_data: 'FFD8FFE000104A4F'}),
             (v115)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'PNG',  image_data: '89504E470D0A1A0E'}),
             (v116)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'JPEG', image_data: 'FFD8FFE000104A50'})

      CREATE (cl7011)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'ESTIMATE', doc_data: '2550444D'}),
             (cl7012)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'PHOTO', doc_data: 'FFD8FFE4'}),
             (cl7013)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'FIR', doc_data: '2550444E'}),
             (cl7013)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 2, doc_type: 'ESTIMATE', doc_data: '2550444F'}),
             (cl7014)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'PHOTO', doc_data: 'FFD8FFE5'}),
             (cl7015)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'ESTIMATE', doc_data: '25504450'})

      CREATE (pay9013)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-02-15'), receipt_file: 'rcpt_9013_1.pdf'}),
             (pay9014)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-08-15'), receipt_file: 'rcpt_9014_1.pdf'}),
             (pay9015)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-03-10'), receipt_file: 'rcpt_9015_1.pdf'}),
             (pay9016)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-04-01'), receipt_file: 'rcpt_9016_1.pdf'}),
             (pay9017)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-05-18'), receipt_file: 'rcpt_9017_1.pdf'}),
             (pay9018)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-06-20'), receipt_file: 'rcpt_9018_1.pdf'});
    `);

    console.log('Insertion completed successfully.');

    console.log('\n3. Verifying updated counts in Neo4j AuraDB...');
    const postCount = await session.run('MATCH (n) RETURN labels(n)[0] AS Label, count(n) AS Total ORDER BY Label;');
    let postTotal = 0;
    postCount.records.forEach(r => {
      const lbl = r.get('Label');
      const count = r.get('Total').toNumber();
      postTotal += count;
      console.log(` - ${lbl}: ${count}`);
    });
    console.log(`NEW TOTAL NODES: ${postTotal} (+${postTotal - preTotal} added!)`);

    const relCounts = await session.run('MATCH ()-[r]->() RETURN type(r) AS Type, count(r) AS Total ORDER BY Type;');
    console.log('\nRelationships in Neo4j AuraDB:');
    let totalRels = 0;
    relCounts.records.forEach(r => {
      const t = r.get('Type');
      const count = r.get('Total').toNumber();
      totalRels += count;
      console.log(` - ${t}: ${count}`);
    });
    console.log(`TOTAL RELATIONSHIPS: ${totalRels}`);

  } finally {
    await session.close();
    await driver.close();
  }
}

insertMoreRecords().catch(err => {
  console.error('INSERTION FAILED:', err);
  process.exit(1);
});

