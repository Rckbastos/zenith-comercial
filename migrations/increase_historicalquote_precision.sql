-- Aumentar precisão da coluna historicalquote
ALTER TABLE orders 
ALTER COLUMN historicalquote TYPE NUMERIC(14,10);

-- Verificar mudança
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'orders' 
  AND column_name = 'historicalquote';
