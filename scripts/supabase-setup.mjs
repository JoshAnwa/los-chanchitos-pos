import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const setupFile = new URL("../supabase/install_new_project.sql", import.meta.url);
const inputs = [
  "check_new_project.sql",
  "migrations/202610170001_initial_schema.sql",
  "migrations/202610180002_staff_orders.sql",
  "migrations/202610190003_order_conflict_http.sql",
  "migrations/202610210004_cash_register.sql",
  "migrations/202610220005_menu_management.sql",
  "migrations/202610260006_self_service_inventory.sql",
  "seed.sql",
];

function unwrapTransaction(sql, name) {
  const lines = sql.replace(/\r\n/g, "\n").trim().split("\n");
  const boundaries = lines.filter((line) => /^(begin|commit|rollback);\s*$/i.test(line));
  if (!boundaries.length) return lines.join("\n");
  if (boundaries.length !== 2 || boundaries[0].trim().toLowerCase() !== "begin;" || boundaries[1].trim().toLowerCase() !== "commit;") {
    throw new Error(`Revisa manualmente los límites de transacción de ${name}.`);
  }
  return lines.filter((line) => !/^(begin|commit);\s*$/i.test(line)).join("\n");
}

export async function buildSetupSql() {
  const parts = await Promise.all(inputs.map(async (name) => {
    const sql = await readFile(new URL(`../supabase/${name}`, import.meta.url), "utf8");
    return `-- Fuente: ${name}\n${unwrapTransaction(sql, name)}`;
  }));
  return [
    "-- Los Chanchitos: instalación inicial, SÓLO para el proyecto NUEVO y vacío.",
    "-- Confirma el nombre y la URL del proyecto en el panel antes de ejecutar.",
    "-- No ejecutar en tu otro proyecto ni en una instalación ya configurada.",
    "-- Todo se ejecuta en una transacción; un error revierte esta instalación.",
    "-- Generado desde check_new_project.sql, las seis migraciones y seed.sql.",
    "-- No editar este archivo por separado. Verificar con npm run supabase:check.",
    "begin;",
    ...parts,
    "commit;",
    "",
  ].join("\n\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const expected = await buildSetupSql();
    if (process.argv.includes("--print")) {
      process.stdout.write(expected);
    } else if (process.argv.includes("--write")) {
      await writeFile(setupFile, expected);
      console.log("✓ Instalador regenerado localmente. No se ejecutó SQL ni se conectó a Supabase.");
    } else {
      const actual = (await readFile(setupFile, "utf8")).replace(/\r\n/g, "\n");
      if (actual.trimEnd() !== expected.trimEnd()) throw new Error("El instalador no coincide con las migraciones. Regénéralo antes de usarlo.");
      console.log("✓ Instalador actualizado. Comprobación local: no se realizó ninguna conexión ni escritura remota.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
