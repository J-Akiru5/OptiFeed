-- Additive: provenance stamp for biomass logs ("form" | "import" | "seed"; null = legacy).
ALTER TABLE "BiomassLog" ADD COLUMN "source" TEXT;
