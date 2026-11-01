// ── TZOOTZ RESEARCH · Chip Console — ROM reproductora ───────────────────────
//
// Programa mínimo para Mega Drive (SGDK): pinta la ficha del tema y lo toca con
// el driver XGM del Z80. El tema no se compila aquí: la app (src/export/rom.ts)
// copia esta ROM y escribe a partir de SONG_BASE una ficha de 256 bytes y, justo
// detrás, la música ya compilada (XGC). Por eso SONG_BASE es fijo y esta ROM se
// rellena hasta esa dirección.
//
//   SONG_BASE + $00  "TZMD"
//             + $04  versión de la ficha (1)
//             + $05  bit 0: el tema tiene bucle
//             + $06  BPM (16 bits)
//             + $08  duración en frames de 1/60 s (32 bits; con bucle, hasta que vuelve)
//             + $10  título      (40 caracteres ASCII, relleno con ceros)
//             + $38  autor       (40)
//             + $60  tercera línea: tono, tempo… (40)
//   SONG_BASE + $100 XGC (tabla de muestras, muestras y música)
#include <genesis.h>

// el logotipo (res/logo.png, que sale de scripts/make-icons.mjs)
#include "gfx.h"

#define SONG_BASE   0x00020000
#define INFO        ((const u8*) SONG_BASE)
#define XGC         ((const u8*) (SONG_BASE + 0x100))

#define COLS        40
#define COL_BACK    0x04100C
#define COL_INK     0x00F48E
#define COL_DIM     0x12925B
#define COL_HOT     0xFFFFFF

static bool paused;
static u32 shown;

static bool hasSong(void)
{
    return INFO[0] == 'T' && INFO[1] == 'Z' && INFO[2] == 'M' && INFO[3] == 'D';
}

static u32 songFrames(void)
{
    return ((u32) INFO[8] << 24) | ((u32) INFO[9] << 16) | ((u32) INFO[10] << 8) | INFO[11];
}

// texto centrado; `src` puede no llevar terminador (campos de ancho fijo de la ficha)
static void center(const u8* src, u16 max, u16 y, u16 pal)
{
    char line[COLS + 1];
    u16 n = 0;

    while (n < max && n < COLS && src[n] >= 32 && src[n] < 127)
    {
        line[n] = src[n];
        n++;
    }
    // sin espacios al final
    while (n > 0 && line[n - 1] == ' ') n--;
    line[n] = 0;

    VDP_setTextPalette(pal);
    VDP_clearTextLine(y);
    if (n) VDP_drawText(line, (COLS - n) / 2, y);
}

static void clock(char* out, u32 frames)
{
    u32 secs = frames / 60;
    u16 m = secs / 60;
    u16 s = secs % 60;

    if (m > 99) m = 99;
    out[0] = '0' + (m / 10);
    out[1] = '0' + (m % 10);
    out[2] = ':';
    out[3] = '0' + (s / 10);
    out[4] = '0' + (s % 10);
    out[5] = 0;
}

static void drawTime(void)
{
    char line[16];
    u32 total = songFrames();
    u32 now = XGM_getElapsed();

    // con bucle, el reloj vuelve a empezar en cada vuelta
    if ((INFO[5] & 1) && total) now %= total;
    else if (total && now > total) now = total;

    clock(line, now);
    line[5] = ' ';
    line[6] = '/';
    line[7] = ' ';
    clock(line + 8, total);

    VDP_setTextPalette(PAL0);
    VDP_drawText(line, (COLS - 13) / 2, 21);
}

static void drawState(void)
{
    VDP_setTextPalette(PAL2);
    VDP_clearTextLine(23);
    if (paused) VDP_drawText("EN PAUSA", (COLS - 8) / 2, 23);
    else if (INFO[5] & 1) VDP_drawText("SONANDO EN BUCLE", (COLS - 16) / 2, 23);
    else VDP_drawText("SONANDO", (COLS - 7) / 2, 23);
}

static void start(void)
{
    paused = FALSE;
    shown = 0xFFFFFFFF;
    XGM_startPlay(XGC);
    drawState();
}

static void joyEvent(u16 joy, u16 changed, u16 state)
{
    if (joy != JOY_1 || !hasSong()) return;

    if (changed & state & BUTTON_START)
    {
        paused = !paused;
        if (paused) XGM_pausePlay();
        else XGM_resumePlay();
        drawState();
    }
    if (changed & state & (BUTTON_A | BUTTON_B | BUTTON_C)) start();
}

int main(bool hardReset)
{
    SYS_disableInts();

    VDP_setScreenWidth320();
    PAL_setColor(0, RGB24_TO_VDPCOLOR(COL_BACK));
    // la fuente usa el color 15 de cada paleta: verde, verde apagado y blanco
    PAL_setColor(15, RGB24_TO_VDPCOLOR(COL_INK));
    PAL_setColor(16 + 15, RGB24_TO_VDPCOLOR(COL_DIM));
    PAL_setColor(32 + 15, RGB24_TO_VDPCOLOR(COL_HOT));

    // logo de 14x9 celdas en el plano B. Su paleta va a PAL3 y se copian solo sus 16 colores:
    // rescomp exporta 64 para un PNG de 8 bits y cargarlos todos pisaria las otras tres paletas
    VDP_drawImageEx(BG_B, &logo, TILE_ATTR_FULL(PAL3, FALSE, FALSE, FALSE, TILE_USER_INDEX), (COLS - 14) / 2, 1, FALSE, FALSE);
    PAL_setColors(PAL3 * 16, logo.palette->data, 16, CPU);

    VDP_setTextPalette(PAL0);
    VDP_drawText("TZOOTZ RESEARCH", (COLS - 15) / 2, 11);
    VDP_setTextPalette(PAL1);
    VDP_drawText("C H I P   C O N S O L E", (COLS - 23) / 2, 12);
    VDP_drawText("YM2612 + SN76489 - DRIVER XGM (SGDK)", (COLS - 36) / 2, 26);

    SYS_enableInts();

    if (!hasSong())
    {
        VDP_setTextPalette(PAL2);
        VDP_drawText("ESTA ROM NO LLEVA NINGUN TEMA", (COLS - 29) / 2, 16);
        VDP_setTextPalette(PAL1);
        VDP_drawText("EXPORTALA DESDE LA APP: EXPORTAR > ROM", (COLS - 38) / 2, 18);
        while (TRUE) SYS_doVBlankProcess();
    }

    center(INFO + 0x10, 40, 15, PAL2);
    center(INFO + 0x38, 40, 17, PAL0);
    center(INFO + 0x60, 40, 19, PAL1);
    VDP_setTextPalette(PAL1);
    VDP_drawText("START PAUSA    A B C DESDE EL PRINCIPIO", 0, 25);

    JOY_setEventHandler(joyEvent);
    // el bucle del tema, si lo tiene, no se acaba nunca
    XGM_setLoopNumber(-1);
    start();

    while (TRUE)
    {
        // el reloj solo se repinta cuando cambia el segundo
        u32 secs = XGM_getElapsed() / 60;
        if (secs != shown)
        {
            shown = secs;
            drawTime();
        }
        SYS_doVBlankProcess();
    }

    return 0;
}
