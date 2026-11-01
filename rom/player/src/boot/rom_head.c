#include "genesis.h"

// Cabecera de la ROM. El exportador de la app reescribe el título (los dos
// campos de 48 caracteres), la dirección final de la ROM y la suma de control.
__attribute__((externally_visible))
const ROMHeader rom_header = {
    "SEGA MEGA DRIVE ",
    "(C)TZOOTZ 2026  ",
    "TZOOTZ CHIP CONSOLE                             ",
    "TZOOTZ CHIP CONSOLE                             ",
    "GM 00000000-00",
    0x000,
    "J               ",
    0x00000000,
    0x0003FFFF,
    0xE0FF0000,
    0xE0FFFFFF,
    "  ",
    0x2020,
    0x20202020,
    0x20202020,
    "            ",
    "TZOOTZ RESEARCH - CHIP CONSOLE          ",
    "JUE             "
};
