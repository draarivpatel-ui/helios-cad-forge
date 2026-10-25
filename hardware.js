/*
 * Helios-6 hardware data: bill of materials, symbols, netlist, pin map and
 * board placement for the RP2040 + INA219 + quadrant LDR telemetry node.
 *
 * UMD module. Browser global: window.HeliosHardware. Node: require('./hardware.js').
 *
 * Pin numbers for U1 (RP2040, QFN-56), U3 (INA219AIDR, SOIC-8), U4 (AP2112K,
 * SOT-23-5) and U2 (W25Q16JVSSIQ, SOIC-8) were checked against the official
 * KiCad symbol library on 2026-10-25. LCSC codes were checked against the LCSC
 * product record for the stated manufacturer part number on the same day.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HeliosHardware = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FP = {
    R0603: 'Resistor_SMD:R_0603_1608Metric',
    C0603: 'Capacitor_SMD:C_0603_1608Metric',
    R1206: 'Resistor_SMD:R_1206_3216Metric',
    LED0805: 'LED_SMD:LED_0805_2012Metric',
    SOIC8_NARROW: 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm',
    SOIC8_WIDE: 'Package_SO:SOIC-8_5.3x5.3mm_P1.27mm',
    SOT235: 'Package_TO_SOT_SMD:SOT-23-5',
    QFN56: 'Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm',
    XTAL3225: 'Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm',
    HDR2: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical',
    HDR3: 'Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical',
    HDR5: 'Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical',
    HDR6: 'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical',
    USBC: 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12',
    TACT: 'Button_Switch_SMD:SW_Push_1P1T_XKB_TS-1187A'
  };

  /** Symbol pin tables: [pad number, pin name, KiCad electrical type]. */
  function pins(list) {
    return list.map(function (s) {
      var parts = s.split('|');
      return { number: parts[0], name: parts[1], type: parts[2] };
    });
  }

  var SYMBOLS = {
    RP2040: {
      prefix: 'U',
      pins: pins([
        '1|IOVDD|power_in', '2|GPIO0|bidirectional', '3|GPIO1|bidirectional', '4|GPIO2|bidirectional',
        '5|GPIO3|bidirectional', '6|GPIO4|bidirectional', '7|GPIO5|bidirectional', '8|GPIO6|bidirectional',
        '9|GPIO7|bidirectional', '10|IOVDD|passive', '11|GPIO8|bidirectional', '12|GPIO9|bidirectional',
        '13|GPIO10|bidirectional', '14|GPIO11|bidirectional', '15|GPIO12|bidirectional', '16|GPIO13|bidirectional',
        '17|GPIO14|bidirectional', '18|GPIO15|bidirectional', '19|TESTEN|input', '20|XIN|input',
        '21|XOUT|output', '22|IOVDD|passive', '23|DVDD|power_in', '24|SWCLK|input',
        '25|SWDIO|bidirectional', '26|RUN|input', '27|GPIO16|bidirectional', '28|GPIO17|bidirectional',
        '29|GPIO18|bidirectional', '30|GPIO19|bidirectional', '31|GPIO20|bidirectional', '32|GPIO21|bidirectional',
        '33|IOVDD|passive', '34|GPIO22|bidirectional', '35|GPIO23|bidirectional', '36|GPIO24|bidirectional',
        '37|GPIO25|bidirectional', '38|GPIO26_ADC0|bidirectional', '39|GPIO27_ADC1|bidirectional',
        '40|GPIO28_ADC2|bidirectional', '41|GPIO29_ADC3|bidirectional', '42|IOVDD|passive',
        '43|ADC_AVDD|power_in', '44|VREG_VIN|power_in', '45|VREG_VOUT|power_out', '46|USB_DM|bidirectional',
        '47|USB_DP|bidirectional', '48|USB_VDD|power_in', '49|IOVDD|passive', '50|DVDD|passive',
        '51|QSPI_SD3|bidirectional', '52|QSPI_SCLK|output', '53|QSPI_SD0|bidirectional', '54|QSPI_SD2|bidirectional',
        '55|QSPI_SD1|bidirectional', '56|QSPI_SS_N|output', '57|GND|power_in'
      ])
    },
    W25Q16JV: {
      prefix: 'U',
      pins: pins([
        '1|CS_N|input', '2|DO_IO1|bidirectional', '3|WP_N_IO2|bidirectional', '4|GND|power_in',
        '5|DI_IO0|bidirectional', '6|CLK|input', '7|HOLD_N_IO3|bidirectional', '8|VCC|power_in'
      ])
    },
    INA219: {
      prefix: 'U',
      pins: pins([
        '1|A1|input', '2|A0|input', '3|SDA|bidirectional', '4|SCL|input',
        '5|VS|power_in', '6|GND|power_in', '7|IN_MINUS|input', '8|IN_PLUS|input'
      ])
    },
    AP2112K: {
      prefix: 'U',
      pins: pins(['1|VIN|power_in', '2|GND|power_in', '3|EN|input', '4|NC|no_connect', '5|VOUT|power_out'])
    },
    CRYSTAL4: {
      prefix: 'Y',
      pins: pins(['1|XTAL1|passive', '2|GND_A|passive', '3|XTAL2|passive', '4|GND_B|passive'])
    },
    USBC: {
      prefix: 'J',
      pins: pins([
        'A1|GND|passive', 'A4|VBUS|passive', 'A5|CC1|passive', 'A6|DP1|passive', 'A7|DN1|passive',
        'A8|SBU1|passive', 'A9|VBUS|passive', 'A12|GND|passive', 'B1|GND|passive', 'B4|VBUS|passive',
        'B5|CC2|passive', 'B6|DP2|passive', 'B7|DN2|passive', 'B8|SBU2|passive', 'B9|VBUS|passive',
        'B12|GND|passive', 'SH|SHIELD|passive'
      ])
    },
    R: { prefix: 'R', pins: pins(['1|1|passive', '2|2|passive']) },
    C: { prefix: 'C', pins: pins(['1|1|passive', '2|2|passive']) },
    LED: { prefix: 'D', pins: pins(['1|K|passive', '2|A|passive']) },
    SWITCH: { prefix: 'SW', pins: pins(['1|1|passive', '2|2|passive']) },
    HDR2: { prefix: 'J', pins: pins(['1|1|passive', '2|2|passive']) },
    HDR3: { prefix: 'J', pins: pins(['1|1|passive', '2|2|passive', '3|3|passive']) },
    HDR5: { prefix: 'J', pins: pins(['1|1|passive', '2|2|passive', '3|3|passive', '4|4|passive', '5|5|passive']) },
    HDR6: {
      prefix: 'J',
      pins: pins(['1|1|passive', '2|2|passive', '3|3|passive', '4|4|passive', '5|5|passive', '6|6|passive'])
    }
  };

  function part(ref, symbol, value, footprint, mpn, manufacturer, lcsc, description) {
    return {
      ref: ref,
      symbol: symbol,
      value: value,
      footprint: footprint,
      mpn: mpn,
      manufacturer: manufacturer,
      lcsc: lcsc,
      description: description,
      onBoard: 1
    };
  }

  var CAP_100N = ['CL10B104KB8NNNC', 'Samsung Electro-Mechanics', 'C1591', '100nF 50V X7R 0603'];
  var CAP_1U = ['CL10A105KB8NNNC', 'Samsung Electro-Mechanics', 'C15849', '1uF 50V X5R 0603'];
  var CAP_10U = ['CL10A106KP8NNNC', 'Samsung Electro-Mechanics', 'C19702', '10uF 10V X5R 0603'];
  var CAP_22P = ['CL10C220JB8NNNC', 'Samsung Electro-Mechanics', 'C1653', '22pF 50V C0G 0603'];
  var RES_10K = ['0603WAF1002T5E', 'UNI-ROYAL', 'C25804', '10k 1% 0603'];
  var RES_1K = ['0603WAF1001T5E', 'UNI-ROYAL', 'C21190', '1k 1% 0603'];
  var RES_27R = ['0603WAF270JT5E', 'UNI-ROYAL', 'C25190', '27 ohm 0603'];
  var RES_5K1 = ['0603WAF5101T5E', 'UNI-ROYAL', 'C23186', '5.1k 1% 0603'];

  function cap(ref, value, spec) {
    return part(ref, 'C', value, FP.C0603, spec[0], spec[1], spec[2], spec[3]);
  }

  function res(ref, value, spec) {
    return part(ref, 'R', value, FP.R0603, spec[0], spec[1], spec[2], spec[3]);
  }

  function header(ref, symbol, footprint, count, mpn, lcsc) {
    return part(ref, symbol, '1x0' + count + ' header', footprint, mpn, 'Ckmtw', lcsc,
      '2.54 mm single-row pin header, ' + count + ' position');
  }

  var COMPONENTS = [
    part('U1', 'RP2040', 'RP2040', FP.QFN56, 'RP2040', 'Raspberry Pi', 'C2040',
      'Dual-core Cortex-M0+ microcontroller, QFN-56'),
    part('U2', 'W25Q16JV', 'W25Q16JVSSIQ', FP.SOIC8_WIDE, 'W25Q16JVSSIQ', 'Winbond', 'C82317',
      '16 Mbit QSPI flash, SOIC-8 208 mil'),
    part('U3', 'INA219', 'INA219AIDR', FP.SOIC8_NARROW, 'INA219AIDR', 'Texas Instruments', 'C138706',
      'I2C current and bus voltage monitor, SOIC-8'),
    part('U4', 'AP2112K', 'AP2112K-3.3', FP.SOT235, 'AP2112K-3.3TRG1', 'Diodes Incorporated', 'C51118',
      '3.3 V 600 mA LDO regulator, SOT-23-5'),
    part('Y1', 'CRYSTAL4', '12MHz', FP.XTAL3225, 'X322512MSB4SI', 'YXC', 'C9002',
      '12 MHz 20 pF crystal, 3225 4-pad'),
    part('J1', 'USBC', 'USB-C', FP.USBC, 'TYPE-C-31-M-12', 'Korean Hroparts Elec', 'C165948',
      'USB Type-C receptacle, 16 position SMD'),
    cap('C1', '10uF', CAP_10U),
    cap('C2', '10uF', CAP_10U),
    cap('C3', '100nF', CAP_100N), cap('C4', '100nF', CAP_100N), cap('C5', '100nF', CAP_100N),
    cap('C6', '100nF', CAP_100N), cap('C7', '100nF', CAP_100N), cap('C8', '100nF', CAP_100N),
    cap('C9', '100nF', CAP_100N), cap('C10', '100nF', CAP_100N), cap('C11', '100nF', CAP_100N),
    cap('C12', '100nF', CAP_100N),
    cap('C13', '1uF', CAP_1U), cap('C14', '1uF', CAP_1U),
    cap('C15', '22pF', CAP_22P), cap('C16', '22pF', CAP_22P),
    cap('C17', '100nF', CAP_100N), cap('C18', '100nF', CAP_100N),
    res('R1', '27R', RES_27R), res('R2', '27R', RES_27R),
    res('R3', '1k', RES_1K),
    res('R4', '10k', RES_10K), res('R5', '10k', RES_10K),
    res('R6', '1k', RES_1K),
    res('R7', '5.1k', RES_5K1), res('R8', '5.1k', RES_5K1),
    res('R9', '10k', RES_10K), res('R10', '10k', RES_10K), res('R11', '10k', RES_10K), res('R12', '10k', RES_10K),
    res('R13', '1k', RES_1K),
    part('R14', 'R', '0R1', FP.R1206, '1206W4F100LT5E', 'UNI-ROYAL', 'C25334', '0.1 ohm 1% 1206 shunt'),
    part('D1', 'LED', 'RED', FP.LED0805, 'NCD0805R1', 'Nationstar', 'C84256', 'Red LED, 0805'),
    part('SW1', 'SWITCH', 'BOOTSEL', FP.TACT, 'TS-1187A-B-A-B', 'XKB Connection', 'C318884',
      'SMD tactile switch, 5.1 x 5.1 mm'),
    part('SW2', 'SWITCH', 'RESET', FP.TACT, 'TS-1187A-B-A-B', 'XKB Connection', 'C318884',
      'SMD tactile switch, 5.1 x 5.1 mm'),
    header('J2', 'HDR5', FP.HDR5, 5, 'B-2100S05P-A110', 'C124379'),
    header('J3', 'HDR5', FP.HDR5, 5, 'B-2100S05P-A110', 'C124379'),
    header('J4', 'HDR6', FP.HDR6, 6, 'B-2100S06P-A110', 'C124380'),
    header('J5', 'HDR2', FP.HDR2, 2, 'B-2100S02P-A110', 'C124375'),
    header('J6', 'HDR2', FP.HDR2, 2, 'B-2100S02P-A110', 'C124375'),
    header('J7', 'HDR3', FP.HDR3, 3, 'B-2100S03P-A110', 'C124376'),
    header('J8', 'HDR3', FP.HDR3, 3, 'B-2100S03P-A110', 'C124376')
  ];

  /**
   * Parts that are wired through headers but not placed on the board. LCSC
   * numbers are left empty where the code could not be checked.
   */
  var OFF_BOARD = [
    { ref: 'LDR1-LDR4', value: 'GL5528', footprint: 'off board', mpn: 'GL5528', manufacturer: 'Senba Sensing',
      lcsc: '', description: 'CdS photoresistor, 5 mm, four on the sensor head via J4', qty: 4 },
    { ref: 'M1-M2', value: 'stepper', footprint: 'off board', mpn: '', manufacturer: '',
      lcsc: '', description: 'Two 200 step per revolution stepper motors, azimuth and elevation', qty: 2 },
    { ref: 'DRV1-DRV2', value: 'driver', footprint: 'off board', mpn: '', manufacturer: '',
      lcsc: '', description: 'Two STEP/DIR/EN stepper driver modules wired to J2 and J3', qty: 2 },
    { ref: 'PV1', value: 'solar panel', footprint: 'off board', mpn: '', manufacturer: '',
      lcsc: '', description: 'Small solar panel on the elevation axis, wired to J5', qty: 1 }
  ];

  /** Net name to list of REF.PIN connections. */
  var NETS = {
    GND: [
      'U1.57', 'U1.19', 'U2.4', 'U3.6', 'U3.1', 'U3.2', 'U4.2',
      'Y1.2', 'Y1.4',
      'J1.A1', 'J1.A12', 'J1.B1', 'J1.B12', 'J1.SH',
      'C1.2', 'C2.2', 'C3.2', 'C4.2', 'C5.2', 'C6.2', 'C7.2', 'C8.2', 'C9.2', 'C10.2', 'C11.2', 'C12.2',
      'C13.2', 'C14.2', 'C15.2', 'C16.2', 'C17.2', 'C18.2',
      'R7.2', 'R8.2', 'R9.2', 'R10.2', 'R11.2', 'R12.2',
      'D1.1', 'SW1.2', 'SW2.2',
      'J2.5', 'J3.5', 'J4.6', 'J5.2', 'J6.2', 'J7.3', 'J8.3'
    ],
    '+3V3': [
      'U1.1', 'U1.10', 'U1.22', 'U1.33', 'U1.42', 'U1.49', 'U1.43', 'U1.44', 'U1.48',
      'U2.8', 'U3.5', 'U4.5',
      'C2.1', 'C3.1', 'C4.1', 'C5.1', 'C6.1', 'C7.1', 'C8.1', 'C9.1', 'C10.1', 'C11.1', 'C12.1', 'C13.1',
      'R4.1', 'R5.1',
      'J2.4', 'J3.4', 'J4.1'
    ],
    VBUS: ['J1.A4', 'J1.A9', 'J1.B4', 'J1.B9', 'U4.1', 'U4.3', 'C1.1'],
    VDD_CORE: ['U1.45', 'U1.23', 'U1.50', 'C14.1', 'C17.1', 'C18.1'],
    USB_CC1: ['J1.A5', 'R7.1'],
    USB_CC2: ['J1.B5', 'R8.1'],
    USB_DP_CON: ['J1.A6', 'J1.B6', 'R1.1'],
    USB_DN_CON: ['J1.A7', 'J1.B7', 'R2.1'],
    USB_DP: ['R1.2', 'U1.47'],
    USB_DN: ['R2.2', 'U1.46'],
    XIN: ['U1.20', 'Y1.1', 'C15.1'],
    XOUT: ['U1.21', 'R6.1'],
    XOUT_R: ['R6.2', 'Y1.3', 'C16.1'],
    QSPI_SS: ['U1.56', 'U2.1', 'R3.1'],
    BOOTSEL: ['R3.2', 'SW1.1'],
    QSPI_SD0: ['U1.53', 'U2.5'],
    QSPI_SD1: ['U1.55', 'U2.2'],
    QSPI_SD2: ['U1.54', 'U2.3'],
    QSPI_SD3: ['U1.51', 'U2.7'],
    QSPI_SCLK: ['U1.52', 'U2.6'],
    RUN: ['U1.26', 'SW2.1'],
    SWCLK: ['U1.24', 'J7.1'],
    SWDIO: ['U1.25', 'J7.2'],
    I2C_SDA: ['U1.2', 'U3.3', 'R4.2'],
    I2C_SCL: ['U1.3', 'U3.4', 'R5.2'],
    STEP_AZ: ['U1.4', 'J2.1'],
    DIR_AZ: ['U1.5', 'J2.2'],
    EN_AZ: ['U1.6', 'J2.3'],
    STEP_EL: ['U1.7', 'J3.1'],
    DIR_EL: ['U1.8', 'J3.2'],
    EN_EL: ['U1.9', 'J3.3'],
    HOME_AZ: ['U1.11', 'J8.1'],
    HOME_EL: ['U1.12', 'J8.2'],
    LED_DRIVE: ['U1.37', 'R13.1'],
    LED_ANODE: ['R13.2', 'D1.2'],
    LDR_NE: ['U1.38', 'J4.2', 'R9.1'],
    LDR_NW: ['U1.39', 'J4.3', 'R10.1'],
    LDR_SW: ['U1.40', 'J4.4', 'R11.1'],
    LDR_SE: ['U1.41', 'J4.5', 'R12.1'],
    PANEL_IN: ['J5.1', 'R14.1', 'U3.8'],
    PANEL_OUT: ['R14.2', 'J6.1', 'U3.7']
  };

  /** Pins deliberately left open: ref.pin with a reason. */
  var NO_CONNECT = {
    'U1.13': 'GPIO10 spare', 'U1.14': 'GPIO11 spare', 'U1.15': 'GPIO12 spare', 'U1.16': 'GPIO13 spare',
    'U1.17': 'GPIO14 spare', 'U1.18': 'GPIO15 spare', 'U1.27': 'GPIO16 spare', 'U1.28': 'GPIO17 spare',
    'U1.29': 'GPIO18 spare', 'U1.30': 'GPIO19 spare', 'U1.31': 'GPIO20 spare', 'U1.32': 'GPIO21 spare',
    'U1.34': 'GPIO22 spare', 'U1.35': 'GPIO23 spare', 'U1.36': 'GPIO24 spare',
    'U4.4': 'no connect on the regulator',
    'J1.A8': 'SBU1 unused', 'J1.B8': 'SBU2 unused'
  };

  /** Human description of what each signal does, used by the pinout table. */
  var SIGNAL_NOTES = {
    I2C_SDA: 'I2C0 data to the INA219 (address 0x40)',
    I2C_SCL: 'I2C0 clock to the INA219',
    STEP_AZ: 'Azimuth stepper STEP pulse to J2',
    DIR_AZ: 'Azimuth stepper direction to J2',
    EN_AZ: 'Azimuth driver enable to J2',
    STEP_EL: 'Elevation stepper STEP pulse to J3',
    DIR_EL: 'Elevation stepper direction to J3',
    EN_EL: 'Elevation driver enable to J3',
    HOME_AZ: 'Azimuth home switch input from J8',
    HOME_EL: 'Elevation home switch input from J8',
    LED_DRIVE: 'Status LED through 1k resistor',
    LDR_NE: 'ADC0, north-east quadrant divider on J4',
    LDR_NW: 'ADC1, north-west quadrant divider on J4',
    LDR_SW: 'ADC2, south-west quadrant divider on J4',
    LDR_SE: 'ADC3, south-east quadrant divider on J4',
    USB_DP: 'USB D+ through 27 ohm series resistor',
    USB_DN: 'USB D- through 27 ohm series resistor',
    SWCLK: 'SWD clock to J7',
    SWDIO: 'SWD data to J7',
    RUN: 'Reset button SW2',
    XIN: '12 MHz crystal input',
    XOUT: '12 MHz crystal output through 1k resistor',
    QSPI_SS: 'Flash chip select, held low by SW1 for BOOTSEL',
    QSPI_SCLK: 'Flash clock',
    QSPI_SD0: 'Flash data 0',
    QSPI_SD1: 'Flash data 1',
    QSPI_SD2: 'Flash data 2',
    QSPI_SD3: 'Flash data 3'
  };

  var BOARD = Object.freeze({ width: 80, height: 56, thickness: 1.6, layers: 2 });

  /** Board placement in millimetres from the top-left corner of the board. */
  var PLACEMENT = {
    U1: [32, 28, 0], U2: [52, 18, 0], U3: [60, 40, 0], U4: [12, 22, 0], Y1: [14, 32, 0], J1: [14, 8, 0],
    J2: [76, 5, 0], J3: [76, 19, 0], J4: [76, 33, 0], J5: [66, 50, 0], J6: [70, 50, 0],
    J7: [50, 46, 0], J8: [44, 46, 0], SW1: [46, 30, 0], SW2: [46, 36, 0], D1: [22, 44, 0],
    R14: [60, 31, 0],
    C3: [25, 20.5, 0], C4: [29, 20.5, 0], C5: [33, 20.5, 0], C6: [37, 20.5, 0],
    C7: [25, 35.5, 0], C8: [29, 35.5, 0], C9: [33, 35.5, 0], C10: [37, 35.5, 0],
    C17: [22, 26, 0], C18: [22, 30, 0],
    C13: [41, 19.5, 0], C14: [40, 24, 0], C11: [47, 22, 0], C12: [60, 35, 0],
    C1: [18, 22, 0], C2: [8, 26, 0], C15: [10, 36, 0], C16: [14, 38, 0],
    R1: [24, 16, 0], R2: [28, 16, 0], R3: [44, 24, 0], R4: [56, 26, 0], R5: [60, 26, 0],
    R6: [18, 36, 0], R7: [24, 10, 0], R8: [28, 10, 0],
    R9: [28, 44, 0], R10: [32, 44, 0], R11: [36, 44, 0], R12: [40, 44, 0], R13: [22, 48, 0]
  };

  /* --------------------------------------------------------------- functions */

  function componentByRef(ref) {
    for (var i = 0; i < COMPONENTS.length; i++) {
      if (COMPONENTS[i].ref === ref) {
        return COMPONENTS[i];
      }
    }
    return null;
  }

  /** Map of "REF.PIN" to net name. Throws if a pin is on two nets. */
  function buildPinNetMap() {
    var map = {};
    Object.keys(NETS).forEach(function (net) {
      NETS[net].forEach(function (endpoint) {
        if (map[endpoint] !== undefined) {
          throw new Error(endpoint + ' is on both ' + map[endpoint] + ' and ' + net);
        }
        map[endpoint] = net;
      });
    });
    return map;
  }

  function refSortKey(ref) {
    var m = /^([A-Za-z]+)(\d+)$/.exec(ref);
    return m ? [m[1], Number(m[2])] : [ref, 0];
  }

  function compareRefs(a, b) {
    var ka = refSortKey(a);
    var kb = refSortKey(b);
    if (ka[0] !== kb[0]) {
      return ka[0] < kb[0] ? -1 : 1;
    }
    return ka[1] - kb[1];
  }

  /** Group placed parts that share value, footprint and MPN into BOM lines. */
  function groupBom() {
    var groups = {};
    var order = [];
    COMPONENTS.forEach(function (c) {
      var key = [c.value, c.footprint, c.mpn].join('|');
      if (!groups[key]) {
        groups[key] = {
          refs: [], qty: 0, value: c.value, footprint: c.footprint, mpn: c.mpn,
          manufacturer: c.manufacturer, lcsc: c.lcsc, description: c.description, offBoard: 0
        };
        order.push(key);
      }
      groups[key].refs.push(c.ref);
      groups[key].qty += 1;
    });
    var lines = order.map(function (key) {
      groups[key].refs.sort(compareRefs);
      return groups[key];
    });
    lines.sort(function (a, b) { return compareRefs(a.refs[0], b.refs[0]); });
    OFF_BOARD.forEach(function (o) {
      lines.push({
        refs: [o.ref], qty: o.qty, value: o.value, footprint: o.footprint, mpn: o.mpn,
        manufacturer: o.manufacturer, lcsc: o.lcsc, description: o.description, offBoard: 1
      });
    });
    return lines;
  }

  function mouserSearchUrl(mpn) {
    return mpn ? 'https://www.mouser.com/c/?q=' + encodeURIComponent(mpn) : '';
  }

  function lcscUrl(code) {
    return code ? 'https://www.lcsc.com/product-detail/' + code + '.html' : '';
  }

  function csvCell(value) {
    var s = String(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function bomToCsv() {
    var header = ['Reference', 'Qty', 'Value', 'Footprint', 'Manufacturer', 'MPN', 'LCSC', 'Mouser search', 'Description', 'Placement'];
    var rows = [header.join(',')];
    groupBom().forEach(function (line) {
      rows.push([
        line.refs.join(' '), line.qty, line.value, line.footprint, line.manufacturer, line.mpn,
        line.lcsc, mouserSearchUrl(line.mpn), line.description, line.offBoard ? 'off board' : 'on board'
      ].map(csvCell).join(','));
    });
    return rows.join('\n') + '\n';
  }

  /** RP2040 pin table: pin number, pin name, net and what the net does. */
  function mcuPinout() {
    var map = buildPinNetMap();
    return SYMBOLS.RP2040.pins.map(function (pin) {
      var net = map['U1.' + pin.number] || '';
      var note = SIGNAL_NOTES[net] || '';
      if (!net) {
        note = NO_CONNECT['U1.' + pin.number] || '';
      }
      return { pin: pin.number, name: pin.name, net: net, note: note };
    });
  }

  /** Connector pin table for every header: connector, pin, net. */
  function connectorPinout() {
    var map = buildPinNetMap();
    var rows = [];
    COMPONENTS.forEach(function (c) {
      if (c.ref.charAt(0) === 'J' && c.ref !== 'J1') {
        SYMBOLS[c.symbol].pins.forEach(function (pin) {
          rows.push({ ref: c.ref, pin: pin.number, net: map[c.ref + '.' + pin.number] || '' });
        });
      }
    });
    return rows;
  }

  function totalPartsOnBoard() {
    return COMPONENTS.length;
  }

  return {
    FP: FP,
    SYMBOLS: SYMBOLS,
    COMPONENTS: COMPONENTS,
    OFF_BOARD: OFF_BOARD,
    NETS: NETS,
    NO_CONNECT: NO_CONNECT,
    SIGNAL_NOTES: SIGNAL_NOTES,
    BOARD: BOARD,
    PLACEMENT: PLACEMENT,
    componentByRef: componentByRef,
    buildPinNetMap: buildPinNetMap,
    compareRefs: compareRefs,
    groupBom: groupBom,
    mouserSearchUrl: mouserSearchUrl,
    lcscUrl: lcscUrl,
    csvCell: csvCell,
    bomToCsv: bomToCsv,
    mcuPinout: mcuPinout,
    connectorPinout: connectorPinout,
    totalPartsOnBoard: totalPartsOnBoard
  };
}));
