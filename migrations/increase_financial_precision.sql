-- Aumentar precisão de colunas financeiras
ALTER TABLE orders ALTER COLUMN quote TYPE NUMERIC(14,10);
ALTER TABLE orders ALTER COLUMN price TYPE NUMERIC(14,4);
ALTER TABLE orders ALTER COLUMN cost TYPE NUMERIC(14,4);
ALTER TABLE orders ALTER COLUMN profit TYPE NUMERIC(14,4);
ALTER TABLE orders ALTER COLUMN unitprice TYPE NUMERIC(14,10);
ALTER TABLE orders ALTER COLUMN commissionvalue TYPE NUMERIC(14,4);

-- Verificar mudanças
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('quote','historicalquote','price','cost','profit','unitprice','commissionvalue')
ORDER BY column_name;
