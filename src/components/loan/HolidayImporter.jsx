import React from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Upload, Calendar, Loader2, Trash2, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function HolidayImporter() {
  const [holidays, setHolidays] = React.useState([]);
  const [importing, setImporting] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [page, setPage] = React.useState(0);
  const [sortOrder, setSortOrder] = React.useState("desc");
  const fileInputRef = React.useRef(null);

  const pageSize = 50;

  React.useEffect(() => {
    loadHolidays();
  }, []);

  const loadHolidays = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await base44.entities.Holiday.list(sortOrder === "desc" ? "-holiday_date" : "holiday_date", 1000);
      setHolidays(data);
    } catch (err) {
      setError("Erro ao carregar feriados: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);

    try {
      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(l => l);
      
      if (lines.length < 2) {
        throw new Error("Arquivo vazio ou sem dados");
      }

      const header = lines[0].split(/[,;\t]/);
      const dataIdx = header.findIndex(h => h.toLowerCase().includes("data"));
      const feriadoIdx = header.findIndex(h => h.toLowerCase().includes("feriado"));
      const diaIdx = header.findIndex(h => h.toLowerCase().includes("dia"));

      if (dataIdx === -1 || feriadoIdx === -1) {
        throw new Error("Arquivo deve conter colunas 'Data' e 'Feriado'");
      }

      const parsed = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/[,;\t]/);
        if (cols.length < 2) continue;

        let dateStr = cols[dataIdx]?.trim();
        if (!dateStr) continue;

        // Parse DD/MM/YYYY to YYYY-MM-DD
        const dateParts = dateStr.split("/");
        if (dateParts.length === 3) {
          dateStr = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`;
        }

        const holidayName = cols[feriadoIdx]?.trim();
        const dayOfWeek = diaIdx !== -1 ? cols[diaIdx]?.trim() : "";

        if (dateStr && holidayName) {
          parsed.push({
            holiday_date: dateStr,
            holiday_name: holidayName,
            day_of_week: dayOfWeek,
          });
        }
      }

      if (parsed.length === 0) {
        throw new Error("Nenhum dado válido encontrado no arquivo");
      }

      // Check for duplicates
      const existing = await base44.entities.Holiday.list("", 10000);
      const existingDates = new Set(existing.map(h => h.holiday_date));
      const newHolidays = parsed.filter(h => !existingDates.has(h.holiday_date));

      if (newHolidays.length === 0) {
        alert("⚠️ Todos os feriados já estão cadastrados.");
        setImporting(false);
        return;
      }

      // Bulk insert
      await base44.entities.Holiday.bulkCreate(newHolidays);
      
      alert(`✅ ${newHolidays.length} feriados importados com sucesso!`);
      await loadHolidays();
    } catch (err) {
      setError("Erro na importação: " + err.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm("⚠️ Deseja realmente excluir TODOS os feriados cadastrados?")) return;
    
    setLoading(true);
    try {
      const all = await base44.entities.Holiday.list("", 10000);
      for (const holiday of all) {
        await base44.entities.Holiday.delete(holiday.id);
      }
      alert("✅ Todos os feriados foram excluídos.");
      await loadHolidays();
    } catch (err) {
      setError("Erro ao excluir: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = () => {
    setSortOrder(prev => prev === "desc" ? "asc" : "desc");
    setPage(0);
  };

  const sortedHolidays = [...holidays].sort((a, b) => {
    const dateA = new Date(a.holiday_date);
    const dateB = new Date(b.holiday_date);
    return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
  });

  const paginatedHolidays = sortedHolidays.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(sortedHolidays.length / pageSize);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Feriados Nacionais
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadHolidays} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeleteAll} disabled={loading || holidays.length === 0}>
              <Trash2 className="w-4 h-4 mr-1" />
              Excluir Todos
            </Button>
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Importar CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg">
          <strong>Formato esperado:</strong> CSV com colunas "Data", "Dia da Semana", "Feriado"<br />
          <strong>Exemplo:</strong> 01/01/2024, Segunda-feira, Confraternização Universal
        </div>

        {loading ? (
          <div className="text-center py-8 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
            Carregando...
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>{sortedHolidays.length} feriados cadastrados</span>
              <Button variant="ghost" size="sm" onClick={toggleSort}>
                Ordenar: {sortOrder === "desc" ? "Mais recente" : "Mais antigo"}
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Dia da Semana</TableHead>
                    <TableHead>Feriado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedHolidays.map((holiday) => (
                    <TableRow key={holiday.id}>
                      <TableCell className="font-mono text-sm">
                        {new Date(holiday.holiday_date + "T12:00:00").toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-sm">{holiday.day_of_week || "—"}</TableCell>
                      <TableCell className="text-sm">{holiday.holiday_name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Anterior
                </Button>
                <span className="text-sm text-slate-600">
                  Página {page + 1} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Próxima
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}