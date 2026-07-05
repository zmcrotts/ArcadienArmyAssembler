const {
  extractTargets
} = require("./extract-leader-targets");

const sample = `
This model can be attached to the following units:
DEATHWATCH KILL TEAM (including FORTIS KILL TEAM, INDOMITOR KILL TEAM),
INTERCESSOR SQUAD,
HELLBLASTER SQUAD.

This model cannot be attached to a unit already containing another Captain.
`;

console.log(
  JSON.stringify(
    extractTargets(sample),
    null,
    2
  )
);