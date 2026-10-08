// Print `id<TAB>filename` for every stored resume (handy for scripting/screenshots).
import { listResumes } from "../src/store/local"

for (const r of await listResumes()) console.log(`${r.id}\t${r.originalFilename}`)
