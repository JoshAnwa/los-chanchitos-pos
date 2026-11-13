-- Ejecutar como administrador sólo en el proyecto autorizado de Los Chanchitos.
-- Crear primero la cuenta en Authentication > Users, con contraseña introducida
-- personalmente por el usuario. Confirmar correo y UUID antes de autorizar acceso.
-- Este archivo no crea contraseñas ni concede acceso al panel de Supabase.
do $activation$
declare
  cashier_email text := 'REEMPLAZAR_CORREO';
  cashier_name text := 'Cajero de prueba';
  expected_auth_id uuid := null; -- Reemplazar por el UUID de la cuenta confirmada.
  cashier_id uuid;
  staff_profile public.profiles;
  target_branch constant uuid := '11111111-1111-1111-1111-111111111111';
begin
  if expected_auth_id is null or cashier_email='REEMPLAZAR_CORREO'
    or length(trim(cashier_email))=0 or length(trim(cashier_name)) not between 1 and 120 then
    raise exception 'CASHIER_ACTIVATION_STOPPED: confirma correo, UUID y nombre antes de ejecutar.';
  end if;
  select id into cashier_id from auth.users where lower(email)=lower(trim(cashier_email));
  if cashier_id is null or cashier_id <> expected_auth_id then
    raise exception 'CASHIER_ACTIVATION_STOPPED: el correo no coincide con el UUID confirmado.';
  end if;
  select * into staff_profile from public.profiles where id=cashier_id for update;
  if not found then
    raise exception 'CASHIER_ACTIVATION_STOPPED: falta el perfil; revisar las migraciones sin reinstalar la base.';
  end if;
  if staff_profile.role <> 'cashier' then
    raise exception 'CASHIER_ACTIVATION_STOPPED: esta plantilla no modifica cuentas Dueño.';
  end if;
  if staff_profile.branch_id is not null and staff_profile.branch_id <> target_branch then
    raise exception 'CASHIER_ACTIVATION_STOPPED: la cuenta pertenece a otra sucursal.';
  end if;
  if not exists(select 1 from public.branches where id=target_branch) then
    raise exception 'CASHIER_ACTIVATION_STOPPED: no existe la sucursal esperada.';
  end if;
  update public.profiles set full_name=trim(cashier_name), role='cashier',
    is_active=true, branch_id=target_branch where id=cashier_id;
end;
$activation$;
