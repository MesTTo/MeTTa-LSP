import { m, mAll, mettaDB, parseSource } from "@metta-ts/edsl";

const db = mettaDB();
const factor = 3;

db.add(m`
  (: triple (-> Number Number))
  (= (triple $x) (* ${factor} $x))
`);

db.add(mAll`
  (: inc (-> Number Number))
  (= (inc $x) (+ $x 1))
`);

export const rows = db.q("(triple $x)");
export const parsed = parseSource("(= (hover-me $x) (+ $x 1))");
export const results = db.run("!(triple 14)");

// Try the plugin inside the strings and templates above:
//   hover `triple`
//   complete `inc`
//   go to the `triple` definition from db.q
//   introduce a typo such as `tripple` and inspect the diagnostic
