-- Un conflicto de versión es definitivo, no un fallo transitorio de serialización.
-- SQLSTATE 40001 hace que PostgREST 14 reintente la transacción indefinidamente.
-- PT409 devuelve HTTP 409 y conserva el mensaje ORDER_CHANGED de la interfaz.
-- Actualización acotada: no borra datos, no cambia permisos ni recrea el esquema.
begin;

do $migration$
declare
  signature text;
  function_id regprocedure;
  definition text;
  legacy constant text := $old$raise exception 'ORDER_CHANGED' using errcode='40001'$old$;
  corrected constant text := $new$raise exception 'ORDER_CHANGED' using errcode='PT409'$new$;
begin
  foreach signature in array array[
    'public.save_pos_order(uuid,integer,uuid,public.order_type,text,jsonb,text)',
    'public.pay_pos_order(uuid,integer,uuid,jsonb)',
    'public.cancel_pos_order(uuid,integer,text)'
  ] loop
    function_id := to_regprocedure(signature);
    if function_id is null then
      raise exception 'CONFLICT_FIX_STOPPED: función requerida ausente: %', signature;
    end if;
    definition := pg_get_functiondef(function_id);
    if strpos(definition, legacy) > 0 then
      if (length(definition) - length(replace(definition, legacy, ''))) / length(legacy) <> 1
        or strpos(definition, corrected) > 0 then
        raise exception 'CONFLICT_FIX_STOPPED: revisar definición de %', signature;
      end if;
      -- pg_get_functiondef produce CREATE OR REPLACE y preserva la configuración.
      -- CREATE OR REPLACE conserva propietario y permisos existentes.
      execute replace(definition, legacy, corrected);
    elsif strpos(definition, corrected) = 0 or strpos(definition, '40001') > 0 then
      raise exception 'CONFLICT_FIX_STOPPED: definición inesperada de %', signature;
    end if;
  end loop;
end;
$migration$;

commit;
