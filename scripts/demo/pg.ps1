param(
	[ValidateSet("init", "status", "reset", "drop")]
	[string]$Action = "status"
)

$ErrorActionPreference = "Stop"

$PgBin = if ($env:PG_BIN) { $env:PG_BIN } else { "C:\Program Files\PostgreSQL\18\bin" }
$PgHost = if ($env:PGHOST_ADDR) { $env:PGHOST_ADDR } else { "127.0.0.1" }
$Port = if ($env:PGPORT) { $env:PGPORT } else { "5433" }
$DbName = if ($env:PG_DB) { $env:PG_DB } else { "optifeed_demo" }
$User = if ($env:PGUSER_NAME) { $env:PGUSER_NAME } else { "postgres" }

function Assert-Tools {
	foreach ($tool in @("pg_isready", "psql", "createdb")) {
		$path = Join-Path $PgBin "$tool.exe"
		if (-not (Test-Path $path)) {
			throw "Missing $tool.exe in $PgBin. Set PG_BIN to a PostgreSQL bin directory."
		}
	}
}

function Test-Ready {
	& (Join-Path $PgBin "pg_isready.exe") -h $PgHost -p $Port *> $null
	if ($LASTEXITCODE -ne 0) {
		throw "No PostgreSQL server on ${PgHost}:$Port. Start the local PostgreSQL service (port $Port) or set PGPORT."
	}
}

function Test-Database {
	$result = & (Join-Path $PgBin "psql.exe") -h $PgHost -p $Port -U $User -w -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'"
	if ($null -eq $result) { return $false }
	return (($result | Out-String).Trim() -eq "1")
}

function Show-Status {
	$dbState = if (Test-Database) { "exists" } else { "missing" }
	Write-Host "SERVER   ${PgHost}:$Port ready"
	Write-Host "DATABASE $DbName $dbState"
	Write-Host ("DATABASE_URL=postgresql://{0}@{1}:{2}/{3}?schema=public" -f $User, $PgHost, $Port, $DbName)
}

Assert-Tools

switch ($Action) {
	"init" {
		Test-Ready
		if (Test-Database) {
			Write-Host "Database '$DbName' already exists"
		} else {
			& (Join-Path $PgBin "createdb.exe") -h $PgHost -p $Port -U $User $DbName
			if ($LASTEXITCODE -ne 0) { throw "createdb failed" }
			Write-Host "Created database '$DbName'"
		}
		Show-Status
	}
	"status" {
		Show-Status
	}
	"reset" {
		Test-Ready
		if (Test-Database) {
			& (Join-Path $PgBin "psql.exe") -h $PgHost -p $Port -U $User -w -c "DROP DATABASE IF EXISTS \"$DbName\" WITH (FORCE)"
			if ($LASTEXITCODE -ne 0) { throw "DROP DATABASE failed" }
		}
		& (Join-Path $PgBin "createdb.exe") -h $PgHost -p $Port -U $User $DbName
		if ($LASTEXITCODE -ne 0) { throw "createdb failed" }
		Write-Host "Recreated database '$DbName'"
		Show-Status
	}
	"drop" {
		Test-Ready
		if (Test-Database) {
			& (Join-Path $PgBin "psql.exe") -h $PgHost -p $Port -U $User -w -c "DROP DATABASE IF EXISTS \"$DbName\" WITH (FORCE)"
			if ($LASTEXITCODE -ne 0) { throw "DROP DATABASE failed" }
			Write-Host "Dropped database '$DbName'"
		} else {
			Write-Host "Database '$DbName' does not exist"
		}
	}
}
