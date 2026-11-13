-- Esta comprobación sólo lee metadatos. Se incluye al inicio del instalador.
-- No identifica por sí sola el proyecto: confirma también nombre y URL en el panel.
do $check_new_project$
declare
  has_buckets boolean;
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  ) then
    raise exception 'INSTALACION_DETENIDA: public ya tiene tablas, vistas o secuencias. Usa el proyecto NUEVO de Los Chanchitos; no borres los datos existentes.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd', 'c')
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_type'::regclass and d.objid = t.oid and d.deptype = 'e'
      )
  ) or exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )
  ) then
    raise exception 'INSTALACION_DETENIDA: public ya tiene tipos o funciones de una aplicación. Revisa el proyecto seleccionado sin modificarlo.';
  end if;

  if exists (select 1 from auth.users) then
    raise exception 'INSTALACION_DETENIDA: ya existen usuarios de Auth. El instalador es sólo para un proyecto nuevo, antes de crear cuentas de personal.';
  end if;

  if to_regclass('storage.buckets') is not null then
    execute 'select exists (select 1 from storage.buckets)' into has_buckets;
    if has_buckets then
      raise exception 'INSTALACION_DETENIDA: ya existen depósitos de Storage. No se modificó su contenido; verifica el proyecto nuevo.';
    end if;
  end if;
end;
$check_new_project$;
