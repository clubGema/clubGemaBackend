const claveDia = (fecha) => {
  if (!fecha) return null;
  if (typeof fecha === 'string') {
    const match = fecha.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return new Date(fecha).toISOString().slice(0, 10);
};

console.log('Case 1: YYYY-MM-DD ->', claveDia('2026-11-04'));
console.log('Case 2: YYYY-MM-DDTHH:mm:ss ->', claveDia('2026-11-04T19:00:00'));
console.log('Case 3: Prisma @db.Date object ->', claveDia(new Date('2026-11-04T00:00:00.000Z')));
console.log('Case 4: Date with ISO ->', claveDia('2026-11-04T00:00:00.000Z'));

