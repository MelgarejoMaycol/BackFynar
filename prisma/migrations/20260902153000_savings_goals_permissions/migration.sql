INSERT INTO permissions (id, code, description)
SELECT gen_random_uuid(), 'goals.read', 'Consultar metas de ahorro'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'goals.read');

INSERT INTO permissions (id, code, description)
SELECT gen_random_uuid(), 'goals.write', 'Crear y modificar metas de ahorro'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'goals.write');
