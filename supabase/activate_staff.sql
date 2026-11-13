-- Ejecutar sólo en el SQL Editor como administrador del proyecto.
-- Primero crear esta cuenta en Authentication > Users > Add user > Create user.
-- Cambiar el correo y nombre de ejemplo antes de ejecutar. No requiere llave service_role.
do $$
declare
  staff_email text := 'REEMPLAZAR_CORREO';
  staff_name text := 'REEMPLAZAR_NOMBRE';
  staff_role public.user_role := 'owner'; -- 'cashier' para un Cajero
  staff_id uuid;
begin
  if staff_email='REEMPLAZAR_CORREO' or staff_name='REEMPLAZAR_NOMBRE' then
    raise exception 'Primero reemplaza el correo y nombre de la cuenta que vas a autorizar.';
  end if;
  select id into staff_id from auth.users where lower(email)=lower(trim(staff_email));
  if staff_id is null then raise exception 'La cuenta no existe todavía en Authentication.'; end if;
  if not exists(select 1 from public.branches where id='11111111-1111-1111-1111-111111111111') then
    raise exception 'Primero ejecuta seed.sql para crear la sucursal.';
  end if;
  update public.profiles set full_name=staff_name,role=staff_role,is_active=true,
    branch_id='11111111-1111-1111-1111-111111111111' where id=staff_id;
  if not found then raise exception 'Falta el perfil de esta cuenta. Revisa que las migraciones se ejecutaron antes de crear usuarios.'; end if;
end;
$$;
