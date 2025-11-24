import { Component, OnInit, OnDestroy, ViewChild, TemplateRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import * as XLSX from 'xlsx';
import { MatMenuModule } from '@angular/material/menu';
import { UsuarioService } from '../services/usuario.service';
 
import { environment } from '../../environments/environment';
import { NotificationService as ToastService } from '../shared/notification/notification.service';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface SensorCard {
  id: string;
  name: string;
  description: string;
  unit: string;
  value: number | null;
  active: boolean;
  icon: string;
  status?: string;
  assigned?: boolean;
}

interface SessionData {
  startTime: string;
  endTime?: string;
  duration: string;
  activeSensors: number;
  totalReadings: number;
  sensorSummary: SensorSummary[];
  recentReadings: Reading[];
}

interface SensorSummary {
  name: string;
  icon: string;
  readings: number;
  average: number;
  max: number;
  min: number;
}

interface Reading {
  sensorName: string;
  sensorIcon: string;
  value: number;
  status: string;
  timestamp: string;
}

interface FullReadingsBySensor {
  mq135: { timestamp: string; value: number; estado: string }[];
  mq4: { timestamp: string; value: number; estado: string }[];
  mq7: { timestamp: string; value: number; estado: string }[];
}

@Component({
  selector: 'user-sensors',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatDialogModule,
    MatMenuModule
  ],
  templateUrl: './user-sensors.component.html',
  styleUrls: ['./user-sensors.component.css']
})
export class UserSensorsComponent implements OnInit, OnDestroy {
  @ViewChild('historyModal') historyModal!: TemplateRef<any>;
  
  lastUpdate: Date = new Date();
  isCapturing = false;
  lastSessionData: SessionData | null = null;
  private apiUrl = environment.apiBaseUrl;
  private assignedCodes = new Set<string>();
  private assignmentPoll: any = null;
  includeCharts = false;
  fullReadings: FullReadingsBySensor | null = null;
  
  // Sensores con datos reales de BD
  sensors: SensorCard[] = [
    { id: 'mq135', name: 'MQ-135', description: 'Calidad del aire (gases)', unit: 'ppm', value: null, active: false, icon: '🏭', status: 'inactive' },
    { id: 'mq7', name: 'MQ-7', description: 'Monóxido de carbono (CO)', unit: 'ppm', value: null, active: false, icon: '⚠️', status: 'inactive' },
    { id: 'mq4', name: 'MQ-4', description: 'Metano (CH₄)', unit: 'ppm', value: null, active: false, icon: '🔥', status: 'inactive' }
  ];

  constructor(
    private usuarioService: UsuarioService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private toast: ToastService
  ) {}

  ngOnInit() {
    // Primero: cargar sensores asignados desde backend
    this.cargarSensoresAsignados().then(() => {
      // Después, cargar estado guardado (pero respetando no asignados)
      this.cargarEstadoSensores();
    });
    this.cargarLecturasRecientes();
    // Actualizar cada 5 segundos si hay captura activa
    setInterval(() => {
      if (this.isCapturing) {
        this.cargarLecturasRecientes();
      }
    }, 5000);

    // Polling ligero de asignaciones para reflejar cambios del admin sin F5
    this.assignmentPoll = setInterval(() => {
      this.cargarSensoresAsignados(true);
    }, 7000);
  }

  ngOnDestroy() {
    if (this.assignmentPoll) {
      clearInterval(this.assignmentPoll);
      this.assignmentPoll = null;
    }
  }


  // Cargar sensores asignados del usuario autenticado
  private async cargarSensoresAsignados(isPolling: boolean = false): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/mis-sensores`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        const codes: string[] = (data?.sensores || []).map((s: any) => String(s.codigo).toLowerCase());
        const newSet = new Set(codes);

        // Detectar cambios para feedback visual sólo si viene por polling
        if (isPolling) {
          this.sensors.forEach(s => {
            const wasAssigned = s.assigned !== false;
            const isNowAssigned = newSet.has(s.id);
            if (wasAssigned && !isNowAssigned) {
              // Fue removido por admin
              s.assigned = false;
              s.active = false;
              s.status = 'not_assigned';
              s.value = null;
              this.toast.showInfo('Asignación actualizada', `${s.name} fue removido por el administrador`);
            } else if (!wasAssigned && isNowAssigned) {
              // Fue agregado por admin
              s.assigned = true;
              s.status = 'inactive';
              s.value = null;
              this.toast.showSuccess('Asignación actualizada', `${s.name} está disponible para activar`);
            }
          });
        } else {
          // Primera carga
          this.sensors.forEach(s => {
            s.assigned = newSet.has(s.id);
            if (!s.assigned) {
              s.active = false;
              s.status = 'not_assigned';
              s.value = null;
            }
          });
        }

        this.assignedCodes = newSet;
      } else {
        // Si falla, considerar no asignados como false sin bloquear UX
        this.sensors.forEach(s => { s.assigned = true; });
      }
    } catch {
      this.sensors.forEach(s => { s.assigned = true; });
    }
  }

  // Cargar estado de sensores desde localStorage
  cargarEstadoSensores() {
    const estadoGuardado = localStorage.getItem('sensores_activos');
    if (estadoGuardado) {
      try {
        const sensoresActivos = JSON.parse(estadoGuardado);
        this.sensors.forEach(sensor => {
          if (sensoresActivos[sensor.id] !== undefined) {
            // Respetar no asignados: mantener inactivos
            sensor.active = sensor.assigned ? sensoresActivos[sensor.id] : false;
          }
        });
        this.actualizarEstadoCaptura();
        console.log('Estado de sensores restaurado:', sensoresActivos);
      } catch (error) {
        console.error('Error al cargar estado de sensores:', error);
      }
    }
  }

  // Guardar estado de sensores en localStorage
  guardarEstadoSensores() {
    const estadoSensores: { [key: string]: boolean } = {};
    this.sensors.forEach(sensor => {
      estadoSensores[sensor.id] = sensor.active;
    });
    localStorage.setItem('sensores_activos', JSON.stringify(estadoSensores));
    console.log('Estado de sensores guardado:', estadoSensores);
  }

  // Alternar estado del sensor (conectado al backend)
  async toggleSensor(sensor: SensorCard, event: any) {
    const isActivating = event.checked;
    // Bloquear si no está asignado
    if (!sensor.assigned) {
      event.source.checked = false;
      sensor.active = false;
      sensor.status = 'not_assigned';
      this.snackBar.open('Este sensor no está asignado a tu cuenta', 'Cerrar', { duration: 3000, panelClass: ['not-assigned-snackbar'] });
      return;
    }

    try {
      if (isActivating) {
        // Activar captura en backend para este sensor específico
        await this.activarCapturaSensor(sensor.id);
        // Sólo marcar activo si quedó en estado normal (conectado). Si está connecting/desconectado, revertir el toggle
        const isConnectedNow = sensor.status === 'normal';
        sensor.active = isConnectedNow;
        if (!isConnectedNow) {
          // Revertir visualmente el toggle; el watcher interno activará cuando lleguen lecturas
          event.source.checked = false;
        }
      } else {
        // Desactivar captura en backend para este sensor específico
        await this.desactivarCapturaSensor(sensor.id);
        sensor.active = false;
      }
      
      // Actualizar el indicador de captura general
      this.actualizarEstadoCaptura();
      // Guardar estado en localStorage
      this.guardarEstadoSensores();
      
    } catch (error) {
      // Revertir estado si falla
      sensor.active = !isActivating;
      event.source.checked = !isActivating;
      this.snackBar.open('Error al cambiar estado de captura', 'Cerrar', { duration: 3000 });
    }
  }

  // Actualizar el estado general de captura
  private actualizarEstadoCaptura() {
    this.isCapturing = this.sensors.some(sensor => sensor.active && sensor.status !== 'disconnected' && sensor.status !== 'connecting');
  }

  // Obtener el estado general de captura
  getCaptureStatus(): { text: string, class: string, icon: string } {
    const sensoresActivos = this.sensors.filter(s => s.active && s.status !== 'disconnected' && s.status !== 'connecting');
    const sensoresDesconectados = this.sensors.filter(s => (s.active || s.status === 'connecting') && s.status === 'disconnected');
    
    if (sensoresActivos.length === 0) {
      return {
        text: 'Captura Inactiva',
        class: 'inactive',
        icon: 'power_off'
      };
    } else if (sensoresDesconectados.length > 0) {
      return {
        text: 'Desconectado',
        class: 'disconnected',
        icon: 'wifi_off'
      };
    } else {
      return {
        text: 'Captura Activa',
        class: 'active',
        icon: 'radio_button_checked'
      };
    }
  }

  // Refrescar datos reales desde BD
  refreshValues() {
    this.cargarLecturasRecientes();
  }

  // Activar captura en backend para todos los sensores
  private async activarCaptura() {
    const response = await fetch(`${this.apiUrl}/captura/activar/1`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Error al activar captura');
    }
    
    this.isCapturing = true;
  }

  // Desactivar captura en backend
  private async desactivarCaptura() {
    const response = await fetch(`${this.apiUrl}/captura/desactivar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Error al desactivar captura');
    }
    
    this.isCapturing = false;
    // Limpiar valores cuando se desactiva
    this.sensors.forEach(s => s.value = null);
  }

  // Activar captura en backend para un sensor específico
  private async activarCapturaSensor(sensorId: string) {
    console.log('[SENSORS] Activando', sensorId, '...');
    const response = await fetch(`${this.apiUrl}/captura/activar/${sensorId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('[SENSORS] Respuesta activar', sensorId, data);
      
      // Actualizar el estado del sensor según la respuesta
      const sensor = this.sensors.find(s => s.id === sensorId);
      if (sensor) {
        // Estados: connected | connecting | desconectado (legacy)
        if (data.estado === 'connecting' && !data.conectado) {
          sensor.status = 'connecting';
          // Mientras conecta no mostrar el último valor histórico
          sensor.value = null;
          console.log('[SENSORS] connecting/gracia', sensorId, data.grace_seconds);
          // Período de gracia: reintentar lecturas hasta que lleguen o venza el timeout
          const graceMs = (data.grace_seconds ? Number(data.grace_seconds) : 15) * 1000;
          const start = Date.now();
          const interval = setInterval(async () => {
            try {
              const r = await fetch(`${this.apiUrl}/lecturas/me?limit=1`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
              });
              if (r.ok) {
                const lecturas = await r.json();
                const arr = lecturas[sensorId] as any[] | undefined;
                if (arr && arr.length > 0) {
                  // Validar recencia real de la lectura contra la ventana de gracia
                  const createdRaw = arr[0]?.creado_en ?? arr[0]?.creadoEn;
                  const createdMs = createdRaw ? new Date(createdRaw).getTime() : 0;
                  const isRecent = createdMs > 0 && (Date.now() - createdMs) <= graceMs;
                  if (isRecent) {
                    sensor.status = 'normal';
                    sensor.active = true;
                    this.actualizarEstadoCaptura();
                    this.guardarEstadoSensores();
                    console.log('[SENSORS] Lectura reciente durante gracia -> conectado', sensorId, new Date(createdMs).toISOString());
                    // Aviso cuando realmente se conectó por llegada de lecturas
                    this.snackBar.open(`📶 ${sensor.name} conectado`, 'Cerrar', {
                      duration: 2500,
                      panelClass: ['success-snackbar'],
                      horizontalPosition: 'center',
                      verticalPosition: 'top'
                    });
                    // Si todos los sensores asignados están conectados, mostrar aviso consolidado
                    const totalAsignados = this.sensors.filter(s => s.assigned !== false).length;
                    const totalConectados = this.sensors.filter(s => s.assigned !== false && s.status === 'normal').length;
                    if (totalAsignados > 0 && totalAsignados === totalConectados) {
                      this.snackBar.open(`✅ Todos los sensores conectados (${totalConectados}/${totalAsignados})`, 'Cerrar', {
                        duration: 3000,
                        panelClass: ['success-snackbar'],
                        horizontalPosition: 'center',
                        verticalPosition: 'top'
                      });
                    }
                    clearInterval(interval);
                  } else {
                    console.log('[SENSORS] Lectura no reciente ignorada', sensorId, createdRaw);
                  }
                }
              }
            } catch {}
            if (Date.now() - start >= graceMs) {
              if (sensor.status === 'connecting') {
                sensor.status = 'disconnected';
                sensor.active = false;
                sensor.value = null;
                const sensorNombre = sensor.name || sensorId.toUpperCase();
                this.toast.showWarning('Sensor desconectado', `${sensorNombre} no envía datos. Verifica el ESP32.`);
                console.log('[SENSORS] Gracia vencida sin lecturas -> desconectado', sensorId);
                // Desactivar en backend para no dejar sesión activa sin lecturas
                try {
                  await fetch(`${this.apiUrl}/captura/desactivar/${sensorId}`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${localStorage.getItem('token')}`,
                      'Content-Type': 'application/json'
                    }
                  });
                } catch {}
                this.actualizarEstadoCaptura();
                this.guardarEstadoSensores();
              }
              clearInterval(interval);
            }
          }, 2000);
        } else if (data.conectado) {
          sensor.status = 'normal';
          console.log('[SENSORS] Activado y conectado', sensorId);
          // Si todos los sensores asignados están conectados, mostrar aviso consolidado
          const totalAsignados = this.sensors.filter(s => s.assigned !== false).length;
          const totalConectados = this.sensors.filter(s => s.assigned !== false && s.status === 'normal').length;
          if (totalAsignados > 0 && totalAsignados === totalConectados) {
            this.snackBar.open(`✅ Todos los sensores conectados (${totalConectados}/${totalAsignados})`, 'Cerrar', {
              duration: 3000,
              panelClass: ['success-snackbar'],
              horizontalPosition: 'center',
              verticalPosition: 'top'
            });
          }
        } else {
          sensor.status = 'disconnected';
          sensor.value = null;
          const sensorNombre = sensor.name || sensorId.toUpperCase();
          this.toast.showWarning('Sensor desconectado', `${sensorNombre} no está disponible. Verifica la conexión.`);
          console.log('[SENSORS] Activación devolvió desconectado', sensorId);
          sensor.active = false;
          // Alinear con Flutter: revertir activación en backend si no está conectado
          try {
            await fetch(`${this.apiUrl}/captura/desactivar/${sensorId}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
              }
            });
          } catch {}
          this.actualizarEstadoCaptura();
          this.guardarEstadoSensores();
        }
      }
    } else {
      const errorData = await response.json();
      console.error('[SENSORS] Error al activar captura', sensorId, errorData);
      this.snackBar.open(
        errorData.detail || 'Error al activar captura del sensor',
        'Cerrar',
        { duration: 5000, panelClass: ['error-snackbar'] }
      );
      // Revertir el estado del sensor si falla la activación
      const sensor = this.sensors.find(s => s.id === sensorId);
      if (sensor) {
        sensor.active = false;
        sensor.status = 'inactive';
      }
    }
  }

  // Desactivar captura en backend para un sensor específico
  private async desactivarCapturaSensor(sensorId: string) {
    const response = await fetch(`${this.apiUrl}/captura/desactivar/${sensorId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Error al desactivar captura');
    }
    
    return response.json();
  }

  // Cargar lecturas recientes desde BD
  private async cargarLecturasRecientes() {
    try {
      const response = await fetch(`${this.apiUrl}/lecturas/me?limit=3`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (response.ok) {
        const lecturas = await response.json();
        this.actualizarValoresSensores(lecturas);
        this.lastUpdate = new Date();
      }
    } catch (error) {
      console.error('Error al cargar lecturas:', error);
    }
  }

  // Desactivar sensores que están marcados como desconectados
  private desactivarSensoresDesconectados() {
    this.sensors.forEach(sensor => {
      if (sensor.status === 'disconnected') {
        sensor.active = false;
      }
    });
    this.actualizarEstadoCaptura();
    this.guardarEstadoSensores();
  }

  // Actualizar valores de sensores con datos reales
  private actualizarValoresSensores(lecturas: any) {
    // Helper: si no está asignado, limpiar y salir
    const skipIfNotAssigned = (sensorCode: string): boolean => {
      const s = this.sensors.find(x => x.id === sensorCode);
      if (s && s.assigned === false) {
        s.value = null;
        s.active = false;
        s.status = 'not_assigned';
        return true;
      }
      return false;
    };

    // Actualizar MQ-135
    if (!skipIfNotAssigned('mq135')) {
    const sensorMQ135 = this.sensors.find(s => s.id === 'mq135');
    if (sensorMQ135 && lecturas.mq135 && lecturas.mq135.length > 0) {
      const ultimaLectura = lecturas.mq135[0];
      sensorMQ135.value = ultimaLectura.valor;
      sensorMQ135.status = ultimaLectura.estado;
    } else if (sensorMQ135 && sensorMQ135.active && sensorMQ135.status !== 'disconnected') {
      sensorMQ135.value = null;
      sensorMQ135.status = 'inactive';
    }
    }

    // Actualizar MQ-4
    if (!skipIfNotAssigned('mq4')) {
      const sensorMQ4 = this.sensors.find(s => s.id === 'mq4');
      if (sensorMQ4 && lecturas.mq4 && lecturas.mq4.length > 0) {
        const ultimaLectura = lecturas.mq4[0];
        sensorMQ4.value = ultimaLectura.valor;
        sensorMQ4.status = ultimaLectura.estado;
      } else if (sensorMQ4 && sensorMQ4.active && sensorMQ4.status !== 'disconnected') {
        sensorMQ4.value = null;
        sensorMQ4.status = 'inactive';
      }
    }

    // Actualizar MQ-7
    if (!skipIfNotAssigned('mq7')) {
      const sensorMQ7 = this.sensors.find(s => s.id === 'mq7');
      if (sensorMQ7 && lecturas.mq7 && lecturas.mq7.length > 0) {
        const ultimaLectura = lecturas.mq7[0];
        sensorMQ7.value = ultimaLectura.valor;
        sensorMQ7.status = ultimaLectura.estado;
      } else if (sensorMQ7 && sensorMQ7.active && sensorMQ7.status !== 'disconnected') {
        sensorMQ7.value = null;
        sensorMQ7.status = 'inactive';
      }
    }
  }

  // Generar valores realistas según el sensor
  private generateRealisticValue(sensorId: string): number {
    switch (sensorId) {
      case 'mq135': // MQ-135 - Calidad del aire (gases tóxicos)
        return Math.round((Math.random() * 300 + 100) * 10) / 10; // 100-400 ppm
      case 'mq7': // MQ-7 - Monóxido de carbono (CO)
        return Math.round((Math.random() * 20 + 1) * 10) / 10; // 1-21 ppm
      case 'mq4': // MQ-4 - Gas metano (CH₄)
        return Math.round((Math.random() * 10 + 0.5) * 10) / 10; // 0.5-10.5 ppm
      default:
        return Math.round(Math.random() * 100);
    }
  }

  // Estadísticas generales
  getActiveSensorsCount(): number {
    return this.sensors.filter(s => s.active).length;
  }

  getAverageValue(): string {
    const activeSensors = this.sensors.filter(s => s.active && s.value !== null);
    if (activeSensors.length === 0) return '0';
    
    const sum = activeSensors.reduce((acc, s) => acc + (s.value || 0), 0);
    const average = sum / activeSensors.length;
    return average.toFixed(1);
  }

  getLastUpdate(): string {
    return this.lastUpdate.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  // Estado del sensor
  getSensorStatus(sensor: SensorCard): string {
    if (sensor.status === 'connecting') return 'connecting';
    if (sensor.assigned === false) return 'not_assigned';
    if (!sensor.active) return 'inactive';
    
    // Si el sensor tiene estado 'disconnected', mantenerlo
    if (sensor.status === 'disconnected') return 'disconnected';
    
    if (!sensor.value) return 'unknown';
    
    // Usar el estado que viene del backend (ya calculado con umbrales dinámicos)
    // El backend envía: "bueno", "advertencia", "malo"
    if (sensor.status === 'bueno') return 'normal';
    if (sensor.status === 'advertencia') return 'warning';
    if (sensor.status === 'malo') return 'danger';
    
    // Fallback: si el estado no coincide, calcular basándose en el valor
    // (solo como respaldo, debería usar siempre el estado del backend)
    switch (sensor.id) {
      case 'mq135': // Calidad del aire
        if (sensor.value! >= 400) return 'danger';        // Malo: ≥ 400 ppm
        if (sensor.value! >= 250) return 'warning';       // Advertencia: 250-399 ppm
        return 'normal';                                   // Bueno: < 250 ppm
      case 'mq4': // Metano / gas natural
        if (sensor.value! >= 50) return 'danger';         // Malo: > 50 ppm (riesgo)
        if (sensor.value! >= 10) return 'warning';        // Advertencia: 10-49 ppm
        return 'normal';                                   // Bueno: < 10 ppm
      case 'mq7': // Monóxido de carbono
        if (sensor.value! >= 35) return 'danger';         // Malo: > 35 ppm
        if (sensor.value! >= 9) return 'warning';         // Advertencia: 9-34 ppm
        return 'normal';                                   // Bueno: < 9 ppm
      default:
        return 'normal';
    }
  }

  getStatusIcon(sensor: SensorCard): string {
    const status = this.getSensorStatus(sensor);
    switch (status) {
      case 'normal': return 'check_circle';
      case 'warning': return 'warning';
      case 'danger': return 'error';
      case 'inactive': return 'power_off';
      case 'connecting': return 'autorenew';
      case 'not_assigned': return 'block';
      case 'disconnected': return 'wifi_off';
      default: return 'help';
    }
  }

  getStatusText(sensor: SensorCard): string {
    const status = this.getSensorStatus(sensor);
    switch (status) {
      case 'normal': return 'Normal';
      case 'warning': return 'Advertencia';
      case 'danger': return 'Peligro';
      case 'inactive': return 'Inactivo';
      case 'connecting': return 'Conectando…';
      case 'not_assigned': return 'No asignado';
      case 'disconnected': return 'Desconectado';
      default: return 'Desconocido';
    }
  }

  // Acciones rápidas
  async activateAllSensors() {
    try {
      let sensoresConectados = 0;
      let sensoresDesconectados = 0;
      let sensoresAsignados = 0;
      let sensoresNoAsignados = 0;
      
      // Activar cada sensor individualmente
      for (const sensor of this.sensors) {
        // Omitir sensores no asignados
        if (sensor.assigned === false) {
          sensoresNoAsignados++;
          continue;
        }
        sensoresAsignados++;
        await this.activarCapturaSensor(sensor.id);
        
        // Solo marcar como activo si está conectado
        if (sensor.status !== 'disconnected') {
          sensor.active = true;
          sensoresConectados++;
        } else {
          sensor.active = false;
          sensoresDesconectados++;
        }
      }
      
      // Sin sensores asignados
      if (sensoresAsignados === 0) {
        // Notificación coherente con el sistema, en naranja
        this.toast.showWarning('Sin sensores asignados', 'No tienes sensores asignados. Solicita al administrador para poder activar.');
      // Mostrar resumen de activación
      } else if (sensoresDesconectados > 0) {
        this.snackBar.open(
          `⚠️ Activados ${sensoresConectados}/${sensoresAsignados}. ${sensoresDesconectados} desconectados. Verifica el ESP32.`, 
          'Cerrar', 
          { 
            duration: 8000,
            panelClass: ['warning-snackbar'],
            horizontalPosition: 'center',
            verticalPosition: 'top'
          }
        );
        
        // Después de 3 segundos, desactivar automáticamente todos los sensores
        setTimeout(() => {
          this.desactivarTodosSensoresAutomaticamente();
        }, 3000);
        
      } else {
        // No mostrar notificación aquí. Se mostrará cuando realmente lleguen lecturas recientes.
      }
      
      this.actualizarEstadoCaptura();
      this.guardarEstadoSensores(); // Guardar estado
      
    } catch (error) {
      this.snackBar.open('Error al activar sensores', 'Cerrar', { 
        duration: 3000,
        panelClass: ['error-snackbar']
      });
    }
  }

  // Desactivar todos los sensores automáticamente después de mostrar alerta
  private async desactivarTodosSensoresAutomaticamente() {
    try {
      // Desactivar cada sensor en el backend
      for (const sensor of this.sensors) {
        await this.desactivarCapturaSensor(sensor.id);
        sensor.active = false;
        sensor.status = 'inactive';
        sensor.value = null;
      }
      
      this.actualizarEstadoCaptura();
      this.guardarEstadoSensores();
      
    } catch (error) {
      console.error('Error al desactivar sensores automáticamente:', error);
      // Aún así actualizar el estado local
      this.sensors.forEach(sensor => {
        sensor.active = false;
        sensor.status = 'inactive';
        sensor.value = null;
      });
      this.actualizarEstadoCaptura();
      this.guardarEstadoSensores();
    }
  }

  async deactivateAllSensors() {
    try {
      // Desactivar cada sensor individualmente
      for (const sensor of this.sensors) {
        await this.desactivarCapturaSensor(sensor.id);
        sensor.active = false;
        sensor.value = null;
      }
      this.actualizarEstadoCaptura();
      this.guardarEstadoSensores(); // Guardar estado
    } catch (error) {
      this.snackBar.open('Error al desactivar sensores', 'Cerrar', { duration: 3000 });
    }
  }

  exportData(format: string = 'json') {
    const data = this.sensors.map(s => ({
      sensor: s.name,
      valor: s.value,
      unidad: s.unit,
      activo: s.active,
      timestamp: new Date().toISOString()
    }));
    
    const timestamp = new Date().toISOString().split('T')[0];
    let blob: Blob;
    let filename: string;
    let mimeType: string;

    switch (format) {
      case 'csv':
        const csvContent = this.convertToCSV(data);
        blob = new Blob([csvContent], { type: 'text/csv' });
        filename = `sensores_${timestamp}.csv`;
        mimeType = 'text/csv';
        break;
      case 'excel':
        // Para Excel, usamos CSV con extensión .xlsx (simplificado)
        const excelContent = this.convertToCSV(data);
        blob = new Blob([excelContent], { type: 'application/vnd.ms-excel' });
        filename = `sensores_${timestamp}.xlsx`;
        mimeType = 'application/vnd.ms-excel';
        break;
      case 'pdf':
        // Para PDF, generamos un texto simple (en una implementación real usarías una librería como jsPDF)
        const pdfContent = this.convertToPDF(data);
        blob = new Blob([pdfContent], { type: 'application/pdf' });
        filename = `sensores_${timestamp}.pdf`;
        mimeType = 'application/pdf';
        break;
      default: // json
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `sensores_${timestamp}.json`;
        mimeType = 'application/json';
    }
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    
    this.snackBar.open(`Datos exportados en formato ${format.toUpperCase()}`, 'Cerrar', { duration: 3000 });
  }

  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => 
      headers.map(header => `"${row[header] || ''}"`).join(',')
    );
    
    return [csvHeaders, ...csvRows].join('\n');
  }

  private convertToPDF(data: any[]): string {
    // Implementación simple para PDF (en producción usarías jsPDF)
    let content = 'REPORTE DE SENSORES\n';
    content += '==================\n\n';
    content += `Fecha: ${new Date().toLocaleDateString()}\n\n`;
    
    data.forEach((item, index) => {
      content += `${index + 1}. ${item.sensor}\n`;
      content += `   Valor: ${item.valor} ${item.unidad}\n`;
      content += `   Estado: ${item.activo ? 'Activo' : 'Inactivo'}\n`;
      content += `   Timestamp: ${item.timestamp}\n\n`;
    });
    
    return content;
  }

  viewHistory() {
    this.loadLastSessionData();
    this.dialog.open(this.historyModal, {
      width: '90vw',
      maxWidth: '1200px',
      maxHeight: '90vh',
      disableClose: false
    });
    // Render charts a la apertura y cuando cambie el toggle
    setTimeout(() => this.renderSessionCharts(), 300);
  }

  // Render simple line charts for the current session without external libs
  renderSessionCharts() {
    // Limpiar canvas si toggle está apagado
    const ids = ['chart-mq135', 'chart-mq7', 'chart-mq4'];
    if (!this.includeCharts) {
      ids.forEach(id => {
        const c = document.getElementById(id) as HTMLCanvasElement | null;
        const ctx = c?.getContext('2d');
        if (ctx && c) ctx.clearRect(0, 0, c.width, c.height);
      });
      return;
    }
    if (!this.lastSessionData) return;
    // Preferir lecturas completas si están disponibles
    const bySensor: Record<string, number[]> = { 'MQ-135': [], 'MQ-4': [], 'MQ-7': [] };
    if (this.fullReadings) {
      bySensor['MQ-135'] = this.fullReadings.mq135.map(r => Number(r.value || 0));
      bySensor['MQ-4'] = this.fullReadings.mq4.map(r => Number(r.value || 0));
      bySensor['MQ-7'] = this.fullReadings.mq7.map(r => Number(r.value || 0));
    } else {
      const readings = this.lastSessionData.recentReadings || [];
      readings.forEach(r => {
        if (bySensor[r.sensorName]) bySensor[r.sensorName].push(Number(r.value || 0));
      });
    }

    const draw = (canvasId: string, label: string, values: number[], color: string, sensorCode: 'mq135'|'mq4'|'mq7') => {
      const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const ratio = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth || 800; const cssH = canvas.clientHeight || 200;
      canvas.width = cssW * ratio; canvas.height = cssH * ratio;
      const w = canvas.width; const h = canvas.height;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1;
      // grid
      for (let i = 0; i <= 4; i++) {
        const y = (h/ratio - 30) * (i / 4) + 10;
        ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(w - 10, y); ctx.stroke();
      }
      // axes
      ctx.strokeStyle = '#9e9e9e'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(40, 10); ctx.lineTo(40, h/ratio - 20); ctx.lineTo(w - 10, h/ratio - 20); ctx.stroke();
      // plot
      if (values.length > 0) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const yFor = (v: number) => (h/ratio - 20) - ((v - min) / range) * (h/ratio - 30);
        // Línea promedio
        const avg = values.reduce((a,b)=>a+b,0)/values.length;
        ctx.strokeStyle = '#607d8b'; ctx.setLineDash([4,4]);
        ctx.beginPath();
        const yAvg = yFor(avg);
        ctx.moveTo(40, yAvg); ctx.lineTo(w - 10, yAvg); ctx.stroke();
        ctx.setLineDash([]);

        // Serie
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        values.forEach((v, idx) => {
          const x = 40 + (idx / Math.max(values.length - 1, 1)) * ((w/ratio) - 50);
          const y = (h/ratio - 20) - ((v - min) / range) * (h/ratio - 30);
          if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        // Legend / labels
        ctx.fillStyle = '#424242'; ctx.font = '12px Arial';
        ctx.fillText(`${label} (min ${min.toFixed(2)} - max ${max.toFixed(2)} - avg ${avg.toFixed(2)})`, 45, 20);

        // Hover tooltip
        const rect = canvas.getBoundingClientRect();
        const points = values.map((v, idx) => {
          const x = 40 + (idx / Math.max(values.length - 1, 1)) * (canvas.clientWidth - 50);
          const y = (canvas.clientHeight - 20) - ((v - min) / range) * (canvas.clientHeight - 30);
          return { x, y, v };
        });
        const tooltipId = `${canvasId}-tooltip`;
        let tip = document.getElementById(tooltipId) as HTMLDivElement | null;
        if (!tip) {
          tip = document.createElement('div'); tip.id = tooltipId;
          tip.style.position = 'fixed'; tip.style.pointerEvents = 'none'; tip.style.background = 'rgba(33,33,33,0.9)';
          tip.style.color = '#fff'; tip.style.padding = '6px 8px'; tip.style.borderRadius = '6px'; tip.style.fontSize = '12px'; tip.style.zIndex = '10000';
          tip.style.display = 'none'; document.body.appendChild(tip);
        }
        const onMove = (ev: MouseEvent) => {
          const mx = ev.clientX - rect.left; const my = ev.clientY - rect.top;
          let nearest = -1; let best = 1e9;
          points.forEach((p, i) => { const dx = p.x - mx; const dy = p.y - my; const d = dx*dx + dy*dy; if (d < best) { best = d; nearest = i; } });
          if (nearest >= 0 && Math.sqrt(best) < 24) {
            tip!.style.display = 'block';
            tip!.textContent = `${values[nearest].toFixed(2)} ppm`;
            tip!.style.left = `${ev.clientX + 12}px`; tip!.style.top = `${ev.clientY + 12}px`;
            // Redibujar marcador sobre el punto
            ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            const px = 40 + (nearest / Math.max(values.length - 1, 1)) * ((w/ratio) - 50);
            const py = (h/ratio - 20) - ((values[nearest] - min) / range) * (h/ratio - 30);
            ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI*2); ctx.fill(); ctx.stroke(); ctx.restore();
          } else {
            tip!.style.display = 'none';
          }
        };
        const onLeave = () => { if (tip) tip.style.display = 'none'; };
        // Limpiar handlers anteriores
        canvas.onmousemove = null; canvas.onmouseleave = null;
        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseleave', onLeave);
      }
    };

    // Esperar a que los canvas tengan tamaño > 0 (el modal anima el layout)
    const ensureAndDraw = (attempt = 0) => {
      const c1 = document.getElementById('chart-mq135') as HTMLCanvasElement | null;
      if (!c1 || (c1.clientWidth === 0 && attempt < 10)) {
        setTimeout(() => ensureAndDraw(attempt + 1), 120);
        return;
      }
      draw('chart-mq135', 'MQ-135', bySensor['MQ-135'], '#2e7d32', 'mq135');
      draw('chart-mq7', 'MQ-7', bySensor['MQ-7'], '#f57c00', 'mq7');
      draw('chart-mq4', 'MQ-4', bySensor['MQ-4'], '#1976d2', 'mq4');
    };
    ensureAndDraw();
  }

  private async limpiarSesionesVacias() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch(`${this.apiUrl}/sesiones/limpiar-vacias`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        if (result.sesiones_eliminadas > 0) {
          console.log(`Se eliminaron ${result.sesiones_eliminadas} sesiones vacías`);
        }
      }
    } catch (error) {
      console.error('Error al limpiar sesiones vacías:', error);
    }
  }

  private async loadLastSessionData() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      // Primero limpiar sesiones vacías
      await this.limpiarSesionesVacias();

      // Usar el nuevo endpoint consolidado
      const response = await fetch(`${this.apiUrl}/sesiones/ultima`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const sesionData = await response.json();
        
        // Obtener lecturas completas de la sesión (rango)
        const query: string[] = [];
        if (sesionData.iniciado_en) query.push(`desde=${encodeURIComponent(sesionData.iniciado_en)}`);
        if (sesionData.finalizado_en) query.push(`hasta=${encodeURIComponent(sesionData.finalizado_en)}`);
        query.push('sensores= mq135,mq4,mq7');
        const lecturasResponse = await fetch(`${this.apiUrl}/reportes/me?${query.join('&')}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        let recentReadings: Reading[] = [];
        if (lecturasResponse.ok) {
          const lecturas = await lecturasResponse.json();
          // Guardar todo para exportaciones (por sensor)
          this.fullReadings = {
            mq135: (lecturas.mq135 || []).map((l: any) => ({ timestamp: String(l.creado_en), value: Number(l.valor), estado: this.mapearEstado(l.estado) })),
            mq4: (lecturas.mq4 || []).map((l: any) => ({ timestamp: String(l.creado_en), value: Number(l.valor), estado: this.mapearEstado(l.estado) })),
            mq7: (lecturas.mq7 || []).map((l: any) => ({ timestamp: String(l.creado_en), value: Number(l.valor), estado: this.mapearEstado(l.estado) }))
          };
          recentReadings = this.procesarLecturasRecientes(lecturas);
        }

        // Crear resumen por sensor usando los datos consolidados
        const sensorSummary: SensorSummary[] = [];
        ['mq135', 'mq4', 'mq7'].forEach((codigo: string) => {
          const sensorData = sesionData.sensores.find((s: any) => s.sensor_codigo === codigo);
          if (sensorData) {
            sensorSummary.push({
              name: this.getSensorName(codigo),
              icon: this.getSensorIcon(codigo),
              readings: sensorData.total_lecturas || 0,
              average: sensorData.promedio_valor || 0,
              max: sensorData.max_valor || 0,
              min: sensorData.min_valor || 0
            });
          } else {
            // Sensor sin sesiones
            sensorSummary.push({
              name: this.getSensorName(codigo),
              icon: this.getSensorIcon(codigo),
              readings: 0,
              average: 0,
              max: 0,
              min: 0
            });
          }
        });

        this.lastSessionData = {
          startTime: sesionData.iniciado_en,
          endTime: sesionData.finalizado_en,
          duration: sesionData.duracion || '0m',
          activeSensors: sesionData.sensores_activos || 0,
          totalReadings: sesionData.total_lecturas || 0,
          sensorSummary: sensorSummary,
          recentReadings: recentReadings
        };
        // Si el usuario activó gráficos, renderizar tras cargar datos
        if (this.includeCharts) {
          setTimeout(() => this.renderSessionCharts(), 100);
        }
      }
    } catch (error) {
      console.error('Error al cargar datos de sesión:', error);
      this.snackBar.open('Error al cargar historial de sesiones', 'Cerrar', { duration: 3000 });
    }
  }

  private procesarLecturasRecientes(lecturas: any): Reading[] {
    const readings: Reading[] = [];
    
    // Procesar MQ-135
    if (lecturas.mq135 && lecturas.mq135.length > 0) {
      lecturas.mq135.slice(0, 3).forEach((lectura: any) => {
        readings.push({
          sensorName: 'MQ-135',
          sensorIcon: 'air',
          value: lectura.valor,
          status: this.mapearEstado(lectura.estado),
          timestamp: lectura.creado_en
        });
      });
    }
    
    // Procesar MQ-4
    if (lecturas.mq4 && lecturas.mq4.length > 0) {
      lecturas.mq4.slice(0, 3).forEach((lectura: any) => {
        readings.push({
          sensorName: 'MQ-4',
          sensorIcon: 'local_fire_department',
          value: lectura.valor,
          status: this.mapearEstado(lectura.estado),
          timestamp: lectura.creado_en
        });
      });
    }
    
    // Procesar MQ-7
    if (lecturas.mq7 && lecturas.mq7.length > 0) {
      lecturas.mq7.slice(0, 3).forEach((lectura: any) => {
        readings.push({
          sensorName: 'MQ-7',
          sensorIcon: 'warning',
          value: lectura.valor,
          status: this.mapearEstado(lectura.estado),
          timestamp: lectura.creado_en
        });
      });
    }
    
    // Ordenar por timestamp descendente y tomar las primeras 10
    return readings.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);
  }

  private getSensorName(codigo: string): string {
    switch (codigo) {
      case 'mq135': return 'MQ-135';
      case 'mq4': return 'MQ-4';
      case 'mq7': return 'MQ-7';
      default: return codigo.toUpperCase();
    }
  }

  private getSensorIcon(codigo: string): string {
    switch (codigo) {
      case 'mq135': return 'air';
      case 'mq4': return 'local_fire_department';
      case 'mq7': return 'warning';
      default: return 'sensors';
    }
  }

  private mapearEstado(estado: string): string {
    switch (estado) {
      case 'bueno': return 'Normal';
      case 'advertencia': return 'Advertencia';
      case 'malo': return 'Peligro';
      default: return estado;
    }
  }

  exportSessionData(format: string = 'json') {
    if (!this.lastSessionData) return;
    const full = this.fullReadings || { mq135: [], mq4: [], mq7: [] };
    const data = {
      sessionInfo: {
        startTime: this.lastSessionData.startTime,
        endTime: this.lastSessionData.endTime,
        duration: this.lastSessionData.duration,
        activeSensors: this.lastSessionData.activeSensors,
        totalReadings: this.lastSessionData.totalReadings
      },
      sensorSummary: this.lastSessionData.sensorSummary,
      readings: full
    };
    
    const timestamp = new Date().toISOString().split('T')[0];
    let blob: Blob;
    let filename: string;

    switch (format) {
      case 'csv':
        const csvContent = this.convertSessionToCSV(data);
        blob = new Blob([csvContent], { type: 'text/csv' });
        filename = `sesion_sensores_${timestamp}.csv`;
        break;
      case 'excel':
        // Crear libro XLSX con una hoja por sensor
        const wb = XLSX.utils.book_new();
        const addSheet = (title: string, rows: { timestamp: string; value: number; estado: string }[]) => {
          const aoa: any[][] = [['Timestamp', 'Valor (ppm)', 'Estado']];
          rows.forEach(r => aoa.push([r.timestamp, r.value, r.estado]));
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          XLSX.utils.book_append_sheet(wb, ws, title);
        };
        addSheet('MQ-135', full.mq135);
        addSheet('MQ-7', full.mq7);
        addSheet('MQ-4', full.mq4);
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        filename = `sesion_sensores_${timestamp}.xlsx`;
        break;
      case 'pdf':
        this.generatePDF(data);
        return; // No necesitamos blob para PDF
      default: // json
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `sesion_sensores_${timestamp}.json`;
    }
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    
    this.snackBar.open(`Datos de sesión exportados en formato ${format.toUpperCase()}`, 'Cerrar', { duration: 3000 });
  }

  private convertSessionToCSV(data: any): string {
    let csv = 'REPORTE DE SESIÓN DE SENSORES\n';
    csv += '=============================\n\n';
    
    // Información de la sesión
    csv += 'INFORMACIÓN DE LA SESIÓN\n';
    csv += 'Inicio,Duracion,Sensores Activos,Total Lecturas\n';
    csv += `"${data.sessionInfo.startTime}","${data.sessionInfo.duration}","${data.sessionInfo.activeSensors}","${data.sessionInfo.totalReadings}"\n\n`;
    
    // Resumen por sensor
    csv += 'RESUMEN POR SENSOR\n';
    csv += 'Sensor,Lecturas,Promedio (ppm),Maximo (ppm),Minimo (ppm)\n';
    data.sensorSummary.forEach((sensor: any) => {
      csv += `"${sensor.name}","${sensor.readings}","${sensor.average}","${sensor.max}","${sensor.min}"\n`;
    });
    
    csv += '\n';
    
    // Lecturas completas por sensor
    const full = this.fullReadings || { mq135: [], mq4: [], mq7: [] };
    csv += '\nLECTURAS MQ-135\n';
    csv += 'Fecha,Valor (ppm),Estado\n';
    full.mq135.forEach(r => { csv += `"${r.timestamp}","${r.value}","${r.estado}"\n`; });
    csv += '\nLECTURAS MQ-7\n';
    csv += 'Fecha,Valor (ppm),Estado\n';
    full.mq7.forEach(r => { csv += `"${r.timestamp}","${r.value}","${r.estado}"\n`; });
    csv += '\nLECTURAS MQ-4\n';
    csv += 'Fecha,Valor (ppm),Estado\n';
    full.mq4.forEach(r => { csv += `"${r.timestamp}","${r.value}","${r.estado}"\n`; });
    
    return csv;
  }

  private generatePDF(data: any) {
    const doc = new jsPDF();
    const timestamp = new Date().toISOString().split('T')[0];
    
    // Configuración de colores
    const primaryColor: [number, number, number] = [76, 175, 80]; // Verde
    const secondaryColor: [number, number, number] = [33, 150, 243]; // Azul
    const textColor: [number, number, number] = [33, 33, 33]; // Gris oscuro
    
    // Título principal
    doc.setFontSize(20);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text('REPORTE DE SESIÓN DE SENSORES', 20, 30);
    
    // Línea decorativa
    doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setLineWidth(0.5);
    doc.line(20, 35, 190, 35);
    
    // Información de la sesión
    doc.setFontSize(14);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('INFORMACIÓN DE LA SESIÓN', 20, 50);
    
    doc.setFontSize(10);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(`Inicio: ${new Date(data.sessionInfo.startTime).toLocaleString()}`, 20, 60);
    if (data.sessionInfo.endTime) {
      doc.text(`Fin: ${new Date(data.sessionInfo.endTime).toLocaleString()}`, 20, 67);
      doc.text(`Duración: ${data.sessionInfo.duration}`, 20, 74);
      doc.text(`Sensores Activos: ${data.sessionInfo.activeSensors}`, 20, 81);
      doc.text(`Total Lecturas: ${data.sessionInfo.totalReadings}`, 20, 88);
    } else {
      doc.text(`Duración: ${data.sessionInfo.duration}`, 20, 67);
      doc.text(`Sensores Activos: ${data.sessionInfo.activeSensors}`, 20, 74);
      doc.text(`Total Lecturas: ${data.sessionInfo.totalReadings}`, 20, 81);
    }
    
    // Resumen por sensor
    const startY = data.sessionInfo.endTime ? 100 : 100;
    doc.setFontSize(14);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('RESUMEN POR SENSOR', 20, startY);
    
    // Tabla de resumen por sensor
    const sensorData = data.sensorSummary.map((sensor: any) => [
      sensor.name,
      sensor.readings.toString(),
      `${sensor.average.toFixed(2)} ppm`,
      `${sensor.max.toFixed(2)} ppm`,
      `${sensor.min.toFixed(2)} ppm`
    ]);

    autoTable(doc, {
      startY: startY + 10,
      head: [['Sensor', 'Lecturas', 'Promedio', 'Máximo', 'Mínimo']],
      body: sensorData,
      theme: 'grid',
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold'
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      },
      margin: { left: 20, right: 20 }
    });
    
    // Orden: por sensor, primero gráfico y luego su tabla
    const full = this.fullReadings || { mq135: [], mq4: [], mq7: [] };
    const sequence = [
      { label: 'MQ-135', canvasId: 'chart-mq135', rows: full.mq135 },
      { label: 'MQ-7', canvasId: 'chart-mq7', rows: full.mq7 },
      { label: 'MQ-4', canvasId: 'chart-mq4', rows: full.mq4 }
    ];
    const pageH = (doc as any).internal?.pageSize?.getHeight ? (doc as any).internal.pageSize.getHeight() : 297; // mm
    const marginTop = 20; const marginBottom = 20;
    let y = (doc as any).lastAutoTable?.finalY + 20 || 30;
    doc.setFontSize(14); doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text('LECTURAS DE LA SESIÓN', 20, y);
    y += 8;

    const drawSection = (label: string, canvasId: string, rows: any[]) => {
      // Gráfico
      if (this.includeCharts) {
        const c = document.getElementById(canvasId) as HTMLCanvasElement | null;
        if (c) {
          const img = c.toDataURL('image/png');
          const imgW = 170; const imgH = 80;
          if (y + imgH + 10 > pageH - marginBottom) { doc.addPage(); y = marginTop; }
          doc.setFontSize(12); doc.setTextColor(33,33,33);
          doc.text(`Gráfico ${label}`, 20, y);
          doc.addImage(img, 'PNG', 20, y + 5, imgW, imgH, undefined, 'FAST');
          y += imgH + 12;
        }
      }
      // Tabla
      const mkRows = (rs: any[]) => rs.map(r => [new Date(r.timestamp).toLocaleString(), `${Number(r.value).toFixed(2)} ppm`, r.estado]);
      const approxTableHeight = Math.min((rows.length + 2) * 7, 180);
      if (y + approxTableHeight > pageH - marginBottom) { doc.addPage(); y = marginTop; }
      doc.setFontSize(12); doc.setTextColor(33,33,33);
      doc.text(`Sensor ${label}`, 20, y);
      autoTable(doc, {
        startY: y + 3,
        head: [['Fecha', 'Valor', 'Estado']],
        body: mkRows(rows),
        theme: 'grid',
        headStyles: { fillColor: secondaryColor, textColor: [255,255,255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245,245,245] },
        margin: { left: 20, right: 20 }
      });
      y = (doc as any).lastAutoTable?.finalY + 12 || y + 24;
    };

    sequence.forEach(s => drawSection(s.label, s.canvasId, s.rows));
    
    // Pie de página
    const finalY2 = (doc as any).lastAutoTable?.finalY + 20 || 200;
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(`Generado el: ${new Date().toLocaleString()}`, 20, finalY2);
    doc.text('Sistema de Monitoreo de Sensores', 20, finalY2 + 7);
    
    // Guardar el PDF
    doc.save(`sesion_sensores_${timestamp}.pdf`);
    
    this.snackBar.open('PDF generado exitosamente', 'Cerrar', { duration: 3000 });
  }
}
