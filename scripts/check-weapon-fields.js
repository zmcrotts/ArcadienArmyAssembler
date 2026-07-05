const fs = require("fs");

const file =
  process.argv[2];

if (!file) {
  console.log("Usage:");
  console.log('node .\\scripts\\check-weapon-fields.js ".\\data\\json\\t-au-empire-datasheets.json"');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));

console.log(`Checking ${data.faction}`);
console.log("");

for (const ds of data.datasheets) {
  for (const w of ds.weapons || []) {

    if (!w.name)
      console.log(`${ds.name}: missing weapon name`);

    if (!w.type)
      console.log(`${ds.name} / ${w.name}: missing weapon type`);

    if (
      w.type.includes("Ranged") &&
      (w.BS === undefined || w.BS === "")
    ) {
      console.log(`${ds.name} / ${w.name}: missing BS`);
    }

    if (
      w.type.includes("Melee") &&
      (w.WS === undefined || w.WS === "")
    ) {
      console.log(`${ds.name} / ${w.name}: missing WS`);
    }

    if (w.A === undefined || w.A === "")
      console.log(`${ds.name} / ${w.name}: missing A`);

    if (w.S === undefined || w.S === "")
      console.log(`${ds.name} / ${w.name}: missing S`);

    if (w.AP === undefined || w.AP === "")
      console.log(`${ds.name} / ${w.name}: missing AP`);

    if (w.D === undefined || w.D === "")
      console.log(`${ds.name} / ${w.name}: missing D`);
  }
}