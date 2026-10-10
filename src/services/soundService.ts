/**
 * Serviço de Alertas Sonoros - CryptoRadar
 * Utiliza a Web Audio API nativa do navegador para sintetizar avisos sonoros
 * de forma 100% offline, leve e sem dependência de arquivos externos de áudio.
 */

class SoundAlertService {
  private audioCtx: AudioContext | null = null;

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  /**
   * Alerta sonoro de sucesso / ordem executada / Take-Profit (arpeggio ascendente harmônico).
   */
  playSuccess(): boolean {
    const ctx = this.getAudioContext();
    if (!ctx) return false;

    try {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99]; // Dó5, Mi5, Sol5 (acorde maior)

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.15, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.25);
      });
      return true;
    } catch (e) {
      console.warn('Falha na reprodução de áudio:', e);
      return false;
    }
  }

  /**
   * Alerta sonoro de aviso / Stop-Loss / volatilidade (dois tons distintos).
   */
  playAlert(): boolean {
    const ctx = this.getAudioContext();
    if (!ctx) return false;

    try {
      const now = ctx.currentTime;
      const notes = [659.25, 493.88]; // Mi5 -> Si4 (alerta descendente)

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        gain.gain.setValueAtTime(0.001, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.28);
      });
      return true;
    } catch (e) {
      console.warn('Falha na reprodução de áudio:', e);
      return false;
    }
  }
}

export const soundService = new SoundAlertService();
