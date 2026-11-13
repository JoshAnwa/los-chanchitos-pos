insert into public.branches (id, name, address)
values ('11111111-1111-1111-1111-111111111111', 'Los Chanchitos · Matriz', 'Sucursal única')
on conflict (id) do nothing;

-- Menú transcrito de la información entregada por el negocio.
-- No se inventan recetas ni existencias: se cargarán cuando el negocio las confirme.
insert into public.products (branch_id, name, category, description, price, sort_order) values
('11111111-1111-1111-1111-111111111111', 'Tacos', 'Antojitos', 'Orden', 25, 1),
('11111111-1111-1111-1111-111111111111', 'Cemitas', 'Antojitos', 'Pieza', 30, 2),
('11111111-1111-1111-1111-111111111111', 'Tacos dorados', 'Antojitos', 'Orden', 25, 3),
('11111111-1111-1111-1111-111111111111', 'Kilo', 'Por peso', '1 kilogramo', 310, 4),
('11111111-1111-1111-1111-111111111111', 'Medio kilo', 'Por peso', '500 gramos', 170, 5),
('11111111-1111-1111-1111-111111111111', 'Cuarto de kilo', 'Por peso', '250 gramos', 100, 6),
('11111111-1111-1111-1111-111111111111', 'Mojarra', 'Platillos', 'Platillo', 120, 7),
('11111111-1111-1111-1111-111111111111', 'Pozole', 'Platillos', 'Plato', 80, 8),
('11111111-1111-1111-1111-111111111111', 'Mole de panza', 'Platillos', 'Plato', 90, 9),
('11111111-1111-1111-1111-111111111111', 'Mixiote de carnero', 'Platillos', 'Platillo', 90, 10),
('11111111-1111-1111-1111-111111111111', 'Pollo', 'Platillos', 'Platillo', 80, 11),
('11111111-1111-1111-1111-111111111111', 'Desayuno', 'Menú del día', 'En el local', 80, 12),
('11111111-1111-1111-1111-111111111111', 'Desayuno para llevar', 'Menú del día', 'Para llevar', 85, 13),
('11111111-1111-1111-1111-111111111111', 'Comida corrida', 'Menú del día', 'En el local', 90, 14),
('11111111-1111-1111-1111-111111111111', 'Comida corrida para llevar', 'Menú del día', 'Para llevar', 95, 15),
('11111111-1111-1111-1111-111111111111', 'Agua · 1 litro', 'Bebidas', '1 litro', 30, 16),
('11111111-1111-1111-1111-111111111111', 'Agua · medio litro', 'Bebidas', '500 ml', 20, 17),
('11111111-1111-1111-1111-111111111111', 'Refresco', 'Bebidas', 'Pieza', 25, 18),
('11111111-1111-1111-1111-111111111111', 'Botana', 'Extras', 'Orden', 20, 19),
('11111111-1111-1111-1111-111111111111', 'Comida · 1 litro', 'Por litro', '1 litro', 150, 20),
('11111111-1111-1111-1111-111111111111', 'Comida · medio litro', 'Por litro', '500 ml', 80, 21),
('11111111-1111-1111-1111-111111111111', 'Arroz · 1 litro', 'Por litro', '1 litro', 70, 22),
('11111111-1111-1111-1111-111111111111', 'Arroz · medio litro', 'Por litro', '500 ml', 35, 23),
('11111111-1111-1111-1111-111111111111', 'Frijoles · 1 litro', 'Por litro', '1 litro', 70, 24),
('11111111-1111-1111-1111-111111111111', 'Frijoles · medio litro', 'Por litro', '500 ml', 35, 25),
('11111111-1111-1111-1111-111111111111', 'Orden de sopa o crema', 'Extras', 'Orden', 25, 26);
