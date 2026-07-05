const fs = require("fs");

const data = JSON.parse(
  fs.readFileSync(
    "data/builder-units/tyranids-builder-units.json",
    "utf8"
  )
);

for (const unit of data.units) {
  const leaderInfoLink = (unit.infoLinks ?? []).find(
    (link) => link.name === "Leader"
  );

  const leaderProfile = (unit.profiles ?? []).find(
    (profile) => profile.name === "Leader"
  );

  if (leaderInfoLink || leaderProfile) {
    console.log(unit.name);
  }
}