const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { parse } = require('csv-parse');

const prisma = new PrismaClient();

const STATE_COORDINATES = {
  'Kuala Lumpur': { lat: 3.139, lng: 101.6869 },
  Selangor: { lat: 3.0738, lng: 101.5183 },
  Penang: { lat: 5.4141, lng: 100.3288 },
  Johor: { lat: 1.4927, lng: 103.7414 },
  Sabah: { lat: 5.9788, lng: 116.0753 },
  Sarawak: { lat: 1.5533, lng: 110.3592 },
  Perak: { lat: 4.5921, lng: 101.0901 },
  Kedah: { lat: 6.1184, lng: 100.3685 },
  Pahang: { lat: 3.8126, lng: 103.3256 },
  'Negeri Sembilan': { lat: 2.7258, lng: 101.9424 },
  Melaka: { lat: 2.1896, lng: 102.2501 },
  Terengganu: { lat: 5.3117, lng: 103.1324 },
  Kelantan: { lat: 6.1254, lng: 102.2381 },
  Perlis: { lat: 6.4449, lng: 100.2048 },
  Putrajaya: { lat: 2.9264, lng: 101.6964 },
  Labuan: { lat: 5.2831, lng: 115.2308 },
};

// 🛠️ AUTO-FIX: Ensure Property Types Exist
async function ensurePropertyTypes() {
  const defaults = [
    { code: 'APARTMENT', name: 'Apartment', description: 'Residential unit' },
    { code: 'CONDOMINIUM', name: 'Condominium', description: 'Luxury unit' },
    { code: 'HOUSE', name: 'House', description: 'Landed property' },
    { code: 'VILLA', name: 'Villa', description: 'Luxury landed' },
    { code: 'TOWNHOUSE', name: 'Townhouse', description: 'Semi-detached' },
    { code: 'STUDIO', name: 'Studio', description: 'Single room unit' },
    { code: 'ROOM', name: 'Room', description: 'Single room rental' },
    {
      code: 'PENTHOUSE',
      name: 'Penthouse',
      description: 'Top floor luxury unit',
    },
  ];

  console.log('🔧 Verifying Property Types...');

  for (const type of defaults) {
    const exists = await prisma.propertyType.findUnique({
      where: { code: type.code },
    });
    if (!exists) {
      console.log(`   - Creating missing type: ${type.name}`);
      await prisma.propertyType.create({ data: type });
    }
  }
}

async function importData() {
  const csvFilePath = path.join(__dirname, '../../prisma/rentals.csv');

  if (!fs.existsSync(csvFilePath)) {
    console.error(`❌ CSV file not found at: ${csvFilePath}`);
    return;
  }

  // 1. Ensure Dependencies (Types & User)
  await ensurePropertyTypes();

  const owner = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!owner) {
    console.error(
      '❌ Error: No ADMIN user found. Please register an admin first.'
    );
    return;
  }

  // Refresh Type Map
  const types = await prisma.propertyType.findMany();
  const typeMap = types.reduce((acc, t) => ({ ...acc, [t.code]: t.id }), {});

  // 2. Parse CSV
  const records = [];
  const parser = fs.createReadStream(csvFilePath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })
  );

  for await (const record of parser) {
    records.push(record);
  }

  console.log(`🚀 Processing ${records.length} records...`);
  let successCount = 0;
  let failCount = 0;

  for (const row of records) {
    try {
      // --- DATA CLEANING START ---

      // Map Type
      let typeCode = 'APARTMENT';
      const rowType = (row.property_type || '').toLowerCase();

      if (rowType.includes('condo')) typeCode = 'CONDOMINIUM';
      else if (
        rowType.includes('house') ||
        rowType.includes('terrace') ||
        rowType.includes('bungalow')
      )
        typeCode = 'HOUSE';
      else if (rowType.includes('villa')) typeCode = 'VILLA';
      else if (rowType.includes('townhouse')) typeCode = 'TOWNHOUSE';
      else if (rowType.includes('studio')) typeCode = 'STUDIO';
      else if (rowType.includes('penthouse')) typeCode = 'PENTHOUSE';

      const typeId = typeMap[typeCode] || typeMap['APARTMENT'];

      // Map Coordinates
      let lat = null;
      let lng = null;
      let stateName = 'Kuala Lumpur';

      for (const [state, coords] of Object.entries(STATE_COORDINATES)) {
        if (row.location && row.location.includes(state)) {
          // Add Jitter
          lat = coords.lat + (Math.random() - 0.5) * 0.05;
          lng = coords.lng + (Math.random() - 0.5) * 0.05;
          stateName = state;
          break;
        }
      }

      // Clean Price & Numbers
      const price =
        parseFloat((row.price || '0').toString().replace(/[^0-9.]/g, '')) || 0;
      const bedrooms = Math.max(0, parseInt(row.bedrooms) || 0);
      const bathrooms = Math.max(0, parseInt(row.bathrooms) || 0);
      const area = parseFloat(row.area) || 100;

      // Clean Images
      let images = [];
      if (row.images) {
        images = row.images
          .split('|')
          .map(url => url.trim())
          .filter(url => url.length > 0 && url.startsWith('http'));
      }

      // Generate Code (Use listing_id if available, otherwise random)
      // ✅ FIX: This ensures the 'code' field is never missing
      const propertyCode = row.listing_id
        ? row.listing_id.trim()
        : `PROP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // --- DATA CLEANING END ---

      await prisma.property.create({
        data: {
          code: propertyCode, // ✅ Added the missing field
          title: (row.title || 'Untitled Property').substring(0, 100),
          description: (
            row.description || `Located in ${row.location}`
          ).substring(0, 5000),
          address: row.location || 'Malaysia',
          city: stateName,
          state: stateName,
          country: 'MY',
          zipCode: '50000',
          latitude: lat,
          longitude: lng,
          price: price,
          currencyCode: 'MYR',
          bedrooms: bedrooms,
          bathrooms: bathrooms,
          areaSqm: area,
          furnished:
            (row.furnished || '').toLowerCase().includes('yes') ||
            (row.furnished || '').toLowerCase().includes('fully'),
          isAvailable: true,
          status: 'APPROVED',
          ownerId: owner.id,
          propertyTypeId: typeId,
          images: images,
        },
      });

      successCount++;
      if (successCount % 50 === 0) process.stdout.write('.');
    } catch (err) {
      failCount++;
      // If it's a unique constraint error (duplicate code), we can usually ignore it
      if (err.code !== 'P2002') {
        if (failCount === 1) {
          console.error('\n❌ FIRST ERROR DETAILS:', err.message);
        }
      }
    }
  }

  console.log(
    `\n✅ Done! Imported: ${successCount} | Failed/Duplicates: ${failCount}`
  );
}

importData()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
