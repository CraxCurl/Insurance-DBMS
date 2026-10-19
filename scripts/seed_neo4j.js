import neo4j from 'neo4j-driver';

const uri = process.env.VITE_NEO4J_URI;
const user = process.env.VITE_NEO4J_USER;
const password = process.env.VITE_NEO4J_PASSWORD;
const database = process.env.VITE_NEO4J_DATABASE || 'e99dbac5';

console.log(`Connecting to Neo4j AuraDB at ${uri} as ${user}...`);

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

async function seed() {
  const session = driver.session({ database });
  try {
    console.log('1. Cleaning existing data in Neo4j...');
    await session.run('MATCH (n) DETACH DELETE n;');
    console.log('Database cleared.');

    console.log('2. Creating Constraints...');
    const constraints = [
      'CREATE CONSTRAINT unique_customer_id IF NOT EXISTS FOR (c:Customer) REQUIRE c.customer_id IS UNIQUE;',
      'CREATE CONSTRAINT unique_customer_email IF NOT EXISTS FOR (c:Customer) REQUIRE c.email IS UNIQUE;',
      'CREATE CONSTRAINT unique_customer_license IF NOT EXISTS FOR (c:Customer) REQUIRE c.license_no IS UNIQUE;',
      'CREATE CONSTRAINT unique_vehicle_id IF NOT EXISTS FOR (v:Vehicle) REQUIRE v.vehicle_id IS UNIQUE;',
      'CREATE CONSTRAINT unique_vehicle_reg IF NOT EXISTS FOR (v:Vehicle) REQUIRE v.reg_no IS UNIQUE;',
      'CREATE CONSTRAINT unique_policy_id IF NOT EXISTS FOR (p:Policy) REQUIRE p.policy_id IS UNIQUE;',
      'CREATE CONSTRAINT unique_claim_id IF NOT EXISTS FOR (cl:Claim) REQUIRE cl.claim_id IS UNIQUE;',
      'CREATE CONSTRAINT unique_payment_id IF NOT EXISTS FOR (pay:Payment) REQUIRE pay.payment_id IS UNIQUE;'
    ];

    for (const c of constraints) {
      try {
        await session.run(c);
      } catch (err) {
        console.warn('Constraint note:', err.message);
      }
    }
    console.log('Constraints created.');

    console.log('3. Inserting Customers, Vehicles, and Policies...');
    await session.run(`
      // Customers
      CREATE (c1:Customer {customer_id: 1, name: 'Arjun Mehta', address: '12 Gandhi Road, Chennai', email: 'arjun.mehta@mail.com', dob: date('1990-03-14'), license_no: 'TN0120100012345', phones: ['9876500001', '9876510001']}),
             (c2:Customer {customer_id: 2, name: 'Sneha Reddy', address: '45 MG Road, Bengaluru', email: 'sneha.reddy@mail.com', dob: date('1988-07-22'), license_no: 'KA0320090054321', phones: ['9876500002']}),
             (c3:Customer {customer_id: 3, name: 'Karthik Iyer', address: '7 Anna Nagar, Chennai', email: 'karthik.iyer@mail.com', dob: date('1992-11-05'), license_no: 'TN0920110067890', phones: ['9876500003', '9876510003']}),
             (c4:Customer {customer_id: 4, name: 'Priya Sharma', address: '88 Sector 15, Noida', email: 'priya.sharma@mail.com', dob: date('1995-01-30'), license_no: 'UP1620160011223', phones: ['9876500004']}),
             (c5:Customer {customer_id: 5, name: 'Rahul Verma', address: '21 Civil Lines, Jaipur', email: 'rahul.verma@mail.com', dob: date('1985-09-18'), license_no: 'RJ1420080033445', phones: ['9876500005']}),
             (c6:Customer {customer_id: 6, name: 'Vinayak Tripathi', address: '14 Lake View Colony, Chennai', email: 'vinayak.25brs1259@mail.com', dob: date('2006-05-10'), license_no: 'TN2220240012259', phones: ['9876500006', '9876510006']}),
             (c7:Customer {customer_id: 7, name: 'Dhruv Upadhyaya', address: '32 Rose Garden Road, Chennai', email: 'dhruv.25brs1232@mail.com', dob: date('2006-08-21'), license_no: 'TN2220240012232', phones: ['9876500007']}),
             (c8:Customer {customer_id: 8, name: 'Arnav Singla', address: '9 Green Park Avenue, Chennai', email: 'arnav.25brs1269@mail.com', dob: date('2006-12-03'), license_no: 'TN2220240012260', phones: ['9876500008']})

      // Vehicles
      CREATE (v101:Vehicle {vehicle_id: 101, fuel_type: 'PETROL', reg_no: 'TN01AB1234', vehicle_model: 'Swift', brand: 'Maruti', mfg_year: 2021, engine_no: 'ENG1001', chassis_no: 'CHS1001'}),
             (v102:Vehicle {vehicle_id: 102, fuel_type: 'DIESEL', reg_no: 'TN01CD5678', vehicle_model: 'Creta', brand: 'Hyundai', mfg_year: 2020, engine_no: 'ENG1002', chassis_no: 'CHS1002'}),
             (v103:Vehicle {vehicle_id: 103, fuel_type: 'PETROL', reg_no: 'KA03EF9012', vehicle_model: 'City', brand: 'Honda', mfg_year: 2022, engine_no: 'ENG1003', chassis_no: 'CHS1003'}),
             (v104:Vehicle {vehicle_id: 104, fuel_type: 'CNG', reg_no: 'TN09GH3456', vehicle_model: 'Ertiga', brand: 'Maruti', mfg_year: 2019, engine_no: 'ENG1004', chassis_no: 'CHS1004'}),
             (v105:Vehicle {vehicle_id: 105, fuel_type: 'ELECTRIC', reg_no: 'UP16JK7890', vehicle_model: 'Nexon EV', brand: 'Tata', mfg_year: 2023, engine_no: 'ENG1005', chassis_no: 'CHS1005'}),
             (v106:Vehicle {vehicle_id: 106, fuel_type: 'DIESEL', reg_no: 'RJ14LM2345', vehicle_model: 'Scorpio', brand: 'Mahindra', mfg_year: 2018, engine_no: 'ENG1006', chassis_no: 'CHS1006'}),
             (v107:Vehicle {vehicle_id: 107, fuel_type: 'PETROL', reg_no: 'TN22NP6789', vehicle_model: 'Baleno', brand: 'Maruti', mfg_year: 2024, engine_no: 'ENG1007', chassis_no: 'CHS1007'}),
             (v108:Vehicle {vehicle_id: 108, fuel_type: 'ELECTRIC', reg_no: 'TN22QR1122', vehicle_model: 'Tiago EV', brand: 'Tata', mfg_year: 2024, engine_no: 'ENG1008', chassis_no: 'CHS1008'}),
             (v109:Vehicle {vehicle_id: 109, fuel_type: 'PETROL', reg_no: 'TN22ST3344', vehicle_model: 'i20', brand: 'Hyundai', mfg_year: 2023, engine_no: 'ENG1009', chassis_no: 'CHS1009'}),
             (v110:Vehicle {vehicle_id: 110, fuel_type: 'PETROL', reg_no: 'TN09UV5566', vehicle_model: 'Polo', brand: 'Volkswagen', mfg_year: 2017, engine_no: 'ENG1010', chassis_no: 'CHS1010'})

      // Policies
      CREATE (p5001:Policy {policy_id: 5001, policy_type: 'COMPREHENSIVE', premium_amount: 18500, start_date: date('2026-01-01'), end_date: date('2026-12-31'), sum_insured: 550000, policy_status: 'ACTIVE'}),
             (p5002:Policy {policy_id: 5002, policy_type: 'COMPREHENSIVE', premium_amount: 24000, start_date: date('2025-06-15'), end_date: date('2026-06-14'), sum_insured: 900000, policy_status: 'EXPIRED'}),
             (p5003:Policy {policy_id: 5003, policy_type: 'THIRD_PARTY', premium_amount: 7200, start_date: date('2026-02-10'), end_date: date('2027-02-09'), sum_insured: 300000, policy_status: 'ACTIVE'}),
             (p5004:Policy {policy_id: 5004, policy_type: 'OWN_DAMAGE', premium_amount: 9800, start_date: date('2026-03-01'), end_date: date('2027-02-28'), sum_insured: 400000, policy_status: 'ACTIVE'}),
             (p5005:Policy {policy_id: 5005, policy_type: 'COMPREHENSIVE', premium_amount: 32000, start_date: date('2026-05-20'), end_date: date('2027-05-19'), sum_insured: 1400000, policy_status: 'ACTIVE'}),
             (p5006:Policy {policy_id: 5006, policy_type: 'THIRD_PARTY', premium_amount: 6500, start_date: date('2025-08-01'), end_date: date('2026-07-31'), sum_insured: 250000, policy_status: 'EXPIRED'}),
             (p5007:Policy {policy_id: 5007, policy_type: 'COMPREHENSIVE', premium_amount: 21000, start_date: date('2026-07-01'), end_date: date('2027-06-30'), sum_insured: 720000, policy_status: 'ACTIVE'}),
             (p5008:Policy {policy_id: 5008, policy_type: 'COMPREHENSIVE', premium_amount: 28500, start_date: date('2026-08-05'), end_date: date('2027-08-04'), sum_insured: 1100000, policy_status: 'ACTIVE'}),
             (p5009:Policy {policy_id: 5009, policy_type: 'OWN_DAMAGE', premium_amount: 15500, start_date: date('2026-04-12'), end_date: date('2027-04-11'), sum_insured: 650000, policy_status: 'CANCELLED'})

      // OWNS
      CREATE (c1)-[:OWNS]->(v101),
             (c1)-[:OWNS]->(v102),
             (c2)-[:OWNS]->(v103),
             (c3)-[:OWNS]->(v104),
             (c4)-[:OWNS]->(v105),
             (c5)-[:OWNS]->(v106),
             (c6)-[:OWNS]->(v107),
             (c7)-[:OWNS]->(v108),
             (c8)-[:OWNS]->(v109),
             (c3)-[:OWNS]->(v110)

      // INSURED_BY
      CREATE (v101)-[:INSURED_BY]->(p5001),
             (v102)-[:INSURED_BY]->(p5002),
             (v103)-[:INSURED_BY]->(p5003),
             (v104)-[:INSURED_BY]->(p5004),
             (v105)-[:INSURED_BY]->(p5005),
             (v106)-[:INSURED_BY]->(p5006),
             (v107)-[:INSURED_BY]->(p5007),
             (v108)-[:INSURED_BY]->(p5008),
             (v109)-[:INSURED_BY]->(p5009);
    `);
    console.log('Customers, Vehicles, Policies created.');

    console.log('4. Inserting Claims, Payments, and Weak Entities...');
    await session.run(`
      MATCH (v101:Vehicle {vehicle_id: 101}), (v102:Vehicle {vehicle_id: 102}), (v103:Vehicle {vehicle_id: 103}),
            (v105:Vehicle {vehicle_id: 105}), (v107:Vehicle {vehicle_id: 107}), (v108:Vehicle {vehicle_id: 108}),
            (p5001:Policy {policy_id: 5001}), (p5002:Policy {policy_id: 5002}), (p5003:Policy {policy_id: 5003}),
            (p5004:Policy {policy_id: 5004}), (p5005:Policy {policy_id: 5005}), (p5006:Policy {policy_id: 5006}),
            (p5007:Policy {policy_id: 5007}), (p5008:Policy {policy_id: 5008}), (p5009:Policy {policy_id: 5009})

      CREATE (v101)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'JPEG', image_data: 'FFD8FFE000104A46'}),
             (v101)-[:HAS_IMAGE]->(:VehicleImage {image_no: 2, image_type: 'JPEG', image_data: 'FFD8FFE000104A47'}),
             (v102)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'PNG',  image_data: '89504E470D0A1A0A'}),
             (v103)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'JPEG', image_data: 'FFD8FFE000104A48'}),
             (v105)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'PNG',  image_data: '89504E470D0A1A0B'}),
             (v105)-[:HAS_IMAGE]->(:VehicleImage {image_no: 2, image_type: 'PNG',  image_data: '89504E470D0A1A0C'}),
             (v107)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'JPEG', image_data: 'FFD8FFE000104A49'}),
             (v108)-[:HAS_IMAGE]->(:VehicleImage {image_no: 1, image_type: 'JPEG', image_data: 'FFD8FFE000104A4A'})

      CREATE (p5001)-[:GENERATES]->(cl7001:Claim {claim_id: 7001, claim_date: date('2026-03-12'), claim_amount: 45000, claim_status: 'SETTLED'}),
             (p5002)-[:GENERATES]->(cl7002:Claim {claim_id: 7002, claim_date: date('2026-01-20'), claim_amount: 120000, claim_status: 'APPROVED'}),
             (p5002)-[:GENERATES]->(cl7003:Claim {claim_id: 7003, claim_date: date('2026-04-02'), claim_amount: 65000, claim_status: 'REJECTED'}),
             (p5004)-[:GENERATES]->(cl7004:Claim {claim_id: 7004, claim_date: date('2026-06-18'), claim_amount: 38000, claim_status: 'PENDING'}),
             (p5005)-[:GENERATES]->(cl7005:Claim {claim_id: 7005, claim_date: date('2026-07-25'), claim_amount: 210000, claim_status: 'APPROVED'}),
             (p5007)-[:GENERATES]->(cl7006:Claim {claim_id: 7006, claim_date: date('2026-08-14'), claim_amount: 30000, claim_status: 'PENDING'}),
             (p5008)-[:GENERATES]->(cl7007:Claim {claim_id: 7007, claim_date: date('2026-09-02'), claim_amount: 95000, claim_status: 'PENDING'}),
             (p5001)-[:GENERATES]->(cl7008:Claim {claim_id: 7008, claim_date: date('2026-08-09'), claim_amount: 15000, claim_status: 'SETTLED'}),
             (p5003)-[:GENERATES]->(cl7009:Claim {claim_id: 7009, claim_date: date('2026-05-05'), claim_amount: 52000, claim_status: 'APPROVED'}),
             (p5006)-[:GENERATES]->(cl7010:Claim {claim_id: 7010, claim_date: date('2025-11-11'), claim_amount: 27000, claim_status: 'SETTLED'})

      CREATE (cl7001)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'FIR', doc_data: '25504446'}),
             (cl7001)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 2, doc_type: 'ESTIMATE', doc_data: '25504447'}),
             (cl7002)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'PHOTO', doc_data: 'FFD8FFE0'}),
             (cl7003)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'ESTIMATE', doc_data: '25504448'}),
             (cl7004)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'PHOTO', doc_data: 'FFD8FFE1'}),
             (cl7005)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'FIR', doc_data: '25504449'}),
             (cl7005)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 2, doc_type: 'PHOTO', doc_data: 'FFD8FFE2'}),
             (cl7005)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 3, doc_type: 'ESTIMATE', doc_data: '2550444A'}),
             (cl7006)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'PHOTO', doc_data: 'FFD8FFE3'}),
             (cl7007)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'FIR', doc_data: '2550444B'}),
             (cl7008)-[:HAS_DOCUMENT]->(:ClaimDocument {doc_no: 1, doc_type: 'ESTIMATE', doc_data: '2550444C'})

      CREATE (p5001)-[:PAID_THROUGH]->(pay9001:Payment {payment_id: 9001, payment_date: date('2026-01-01'), payment_method: 'UPI', amount: 9250}),
             (p5001)-[:PAID_THROUGH]->(pay9002:Payment {payment_id: 9002, payment_date: date('2026-07-01'), payment_method: 'UPI', amount: 9250}),
             (p5002)-[:PAID_THROUGH]->(pay9003:Payment {payment_id: 9003, payment_date: date('2025-06-15'), payment_method: 'CARD', amount: 24000}),
             (p5003)-[:PAID_THROUGH]->(pay9004:Payment {payment_id: 9004, payment_date: date('2026-02-10'), payment_method: 'NETBANKING', amount: 7200}),
             (p5004)-[:PAID_THROUGH]->(pay9005:Payment {payment_id: 9005, payment_date: date('2026-03-01'), payment_method: 'CARD', amount: 9800}),
             (p5005)-[:PAID_THROUGH]->(pay9006:Payment {payment_id: 9006, payment_date: date('2026-05-20'), payment_method: 'NETBANKING', amount: 16000}),
             (p5005)-[:PAID_THROUGH]->(pay9007:Payment {payment_id: 9007, payment_date: date('2026-08-20'), payment_method: 'NETBANKING', amount: 16000}),
             (p5006)-[:PAID_THROUGH]->(pay9008:Payment {payment_id: 9008, payment_date: date('2025-08-01'), payment_method: 'CASH', amount: 6500}),
             (p5007)-[:PAID_THROUGH]->(pay9009:Payment {payment_id: 9009, payment_date: date('2026-07-01'), payment_method: 'UPI', amount: 10500}),
             (p5008)-[:PAID_THROUGH]->(pay9010:Payment {payment_id: 9010, payment_date: date('2026-08-05'), payment_method: 'CARD', amount: 14250}),
             (p5008)-[:PAID_THROUGH]->(pay9011:Payment {payment_id: 9011, payment_date: date('2026-09-05'), payment_method: 'UPI', amount: 14250}),
             (p5009)-[:PAID_THROUGH]->(pay9012:Payment {payment_id: 9012, payment_date: date('2026-04-12'), payment_method: 'CHEQUE', amount: 15500})

      CREATE (pay9001)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-01-01'), receipt_file: 'rcpt_9001_1.pdf'}),
             (pay9002)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-07-01'), receipt_file: 'rcpt_9002_1.pdf'}),
             (pay9003)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2025-06-15'), receipt_file: 'rcpt_9003_1.pdf'}),
             (pay9005)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-03-01'), receipt_file: 'rcpt_9005_1.pdf'}),
             (pay9005)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 2, receipt_date: date('2026-03-05'), receipt_file: 'rcpt_9005_2.pdf'}),
             (pay9006)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-05-20'), receipt_file: 'rcpt_9006_1.pdf'}),
             (pay9009)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-07-01'), receipt_file: 'rcpt_9009_1.pdf'}),
             (pay9010)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-08-05'), receipt_file: 'rcpt_9010_1.pdf'}),
             (pay9011)-[:HAS_RECEIPT]->(:PaymentReceipt {receipt_no: 1, receipt_date: date('2026-09-05'), receipt_file: 'rcpt_9011_1.pdf'});
    `);
    console.log('Claims, Payments, and Weak Entities created.');

    console.log('\n5. Verifying Counts in Neo4j...');
    const nodeCounts = await session.run(`
      MATCH (n) RETURN labels(n)[0] AS Label, count(n) AS Total ORDER BY Label;
    `);
    console.log('Nodes in Neo4j:');
    let totalNodes = 0;
    nodeCounts.records.forEach(r => {
      const lbl = r.get('Label');
      const count = r.get('Total').toNumber();
      totalNodes += count;
      console.log(` - ${lbl}: ${count}`);
    });
    console.log(`TOTAL NODES: ${totalNodes}`);

    const relCounts = await session.run(`
      MATCH ()-[r]->() RETURN type(r) AS Type, count(r) AS Total ORDER BY Type;
    `);
    console.log('\nRelationships in Neo4j:');
    let totalRels = 0;
    relCounts.records.forEach(r => {
      const t = r.get('Type');
      const count = r.get('Total').toNumber();
      totalRels += count;
      console.log(` - ${t}: ${count}`);
    });
    console.log(`TOTAL RELATIONSHIPS: ${totalRels}`);

    console.log('\nSUCCESS! Database seeded directly into Neo4j AuraDB!');
  } finally {
    await session.close();
    await driver.close();
  }
}

seed().catch(err => {
  console.error('SEEDING FAILED:', err);
  process.exit(1);
});
