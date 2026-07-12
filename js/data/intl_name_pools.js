// International name pools — fictional combinations, no real players.
// The international pipeline (js/engine/intl.js) renames prospects and
// event players by origin so a 16-year-old from Japan doesn't sign as
// "Dean Pennington". Countries without a pool here (e.g. Australia)
// keep the default BBGM_NAMES draw.
window.BBGM_INTL_NAMES = (function () {
  const POOLS = {
    // Spanish-speaking Latin America + Caribbean: Dominican Republic,
    // Venezuela, Cuba, Mexico, Puerto Rico, Colombia, Panama, Nicaragua.
    hispanic: {
      first: [
        'Adalberto','Adonis','Alejandro','Alexis','Alfonso','Alvaro','Amado','Amaury','Anderson','Andres',
        'Angel','Anibal','Antonio','Argenis','Ariel','Armando','Arturo','Aurelio','Benito','Bernardo',
        'Braulio','Camilo','Carlos','Cesar','Cristian','Cristobal','Dario','Delvin','Denny','Diego',
        'Domingo','Edgardo','Edinson','Eduardo','Efrain','Elvin','Emiliano','Emilio','Enrique','Erick',
        'Ernesto','Esteban','Eugenio','Ezequiel','Fabio','Faustino','Federico','Felipe','Felix','Fernando',
        'Francisco','Franklin','Geraldo','German','Gilberto','Gregorio','Guillermo','Gustavo','Hector','Heriberto',
        'Hernan','Horacio','Humberto','Ignacio','Ismael','Israel','Jairo','Javier','Jeremias','Jesus',
        'Joaquin','Jorge','Jose','Josue','Juan','Julio','Leandro','Leonel','Lorenzo','Luis',
        'Manuel','Marcelo','Marcos','Mariano','Mario','Mateo','Mauricio','Miguel','Milton','Nelson',
        'Nestor','Nicolas','Octavio','Omar','Orlando','Osvaldo','Pablo','Pedro','Rafael','Ramon',
        'Raul','Reinaldo','Renato','Ricardo','Roberto','Rodolfo','Rogelio','Rolando','Ruben','Salvador',
        'Samuel','Santiago','Santos','Saul','Sergio','Teodoro','Tomas','Ulises','Valentin','Vicente',
        'Victor','Wilfredo','Willy','Wilmer','Xavier','Yadiel','Yeison','Yohan','Yunior','Zoilo',
      ],
      last: [
        'Abreu','Acevedo','Acosta','Aguilar','Alcantara','Almonte','Alvarado','Alvarez','Amador','Aquino',
        'Arias','Astacio','Baez','Barrios','Batista','Bautista','Bello','Beltran','Benitez','Betances',
        'Bonilla','Brito','Bueno','Caballero','Cabral','Cabrera','Calderon','Campos','Candelario','Carmona',
        'Carrasco','Casilla','Castellanos','Castillo','Castro','Cedeno','Cepeda','Colon','Concepcion','Contreras',
        'Cordero','Corona','Correa','Cruz','Cuellar','De La Cruz','De La Rosa','Del Rosario','Diaz','Dominguez',
        'Duarte','Encarnacion','Escobar','Espinal','Estevez','Feliz','Fermin','Figueroa','Flores','Fuentes',
        'Galvez','Garcia','Gomez','Gonzalez','Guerrero','Guillen','Gutierrez','Guzman','Henriquez','Heredia',
        'Hernandez','Herrera','Hidalgo','Ibanez','Infante','Jimenez','Lara','Ledesma','Liriano','Lopez',
        'Lugo','Maldonado','Marcano','Marte','Martinez','Mateo','Matos','Medina','Mejia','Melendez',
        'Mendez','Mendoza','Mercedes','Mesa','Molina','Montero','Morales','Moreno','Mota','Munoz',
        'Naranjo','Navarro','Nova','Nunez','Ogando','Olivares','Ortega','Ortiz','Ozuna','Pacheco',
        'Paredes','Paulino','Pena','Peralta','Perdomo','Perez','Pimentel','Pineda','Polanco','Quintana',
        'Ramirez','Ramos','Rengifo','Reyes','Reynoso','Rijo','Rios','Rivas','Rivera','Robles',
        'Rodriguez','Rojas','Romero','Rondon','Rosado','Rosario','Ruiz','Salazar','Sanchez','Santana',
        'Santos','Segura','Sierra','Solano','Soriano','Sosa','Soto','Tavarez','Tejada','Torres',
        'Urena','Uribe','Valdez','Valenzuela','Vargas','Vasquez','Vega','Velazquez','Ventura','Villanueva',
        'Vizcaino','Zambrano','Zapata',
      ],
    },
    japan: {
      first: [
        'Akira','Daichi','Daiki','Daisuke','Haruki','Hayato','Hideki','Hideo','Hiroki','Hiroshi',
        'Hisashi','Itsuki','Kaito','Katsuya','Kazuki','Kazuya','Keisuke','Kenji','Kenta','Koji',
        'Kosuke','Makoto','Masahiro','Masato','Naoki','Naoya','Noboru','Osamu','Ren','Riku',
        'Ryo','Ryosuke','Ryota','Ryuji','Satoshi','Shigeru','Shinji','Shintaro','Sho','Shota',
        'Shun','Shunsuke','Sora','Sosuke','Takashi','Takeshi','Takuma','Takumi','Taro','Tatsuya',
        'Tetsuya','Tomoya','Toru','Toshiro','Tsubasa','Wataru','Yamato','Yasuo','Yoshiki','Yudai',
        'Yuki','Yuma','Yusuke','Yuta','Yuto',
      ],
      last: [
        'Abe','Aoki','Arai','Endo','Fujii','Fujimoto','Fujita','Fukuda','Goto','Hara',
        'Harada','Hasegawa','Hashimoto','Hayashi','Hirano','Honda','Hoshino','Iida','Ikeda','Imai',
        'Inoue','Ishida','Ishii','Ishikawa','Ito','Iwasaki','Kaneko','Kato','Kawaguchi','Kawasaki',
        'Kikuchi','Kimura','Kinoshita','Kobayashi','Koike','Kondo','Kubo','Kudo','Maeda','Maruyama',
        'Masuda','Matsuda','Matsui','Matsumoto','Miura','Miyamoto','Miyazaki','Mizuno','Mori','Morita',
        'Murakami','Murata','Nagai','Nakagawa','Nakajima','Nakamura','Nakano','Nishida','Nishimura','Noguchi',
        'Nomura','Ogawa','Okada','Okamoto','Ono','Ota','Saito','Sakai','Sakamoto','Sano',
        'Sasaki','Sato','Shibata','Shimizu','Sugiyama','Suzuki','Takagi','Takahashi','Takeda','Tamura',
        'Tanaka','Taniguchi','Uchida','Ueda','Wada','Watanabe','Yamada','Yamaguchi','Yamamoto','Yamashita',
        'Yano','Yokoyama','Yoshida',
      ],
    },
    korea: {
      first: [
        'Byung-ho','Chan-woo','Dae-sung','Dong-hyun','Geon-woo','Ha-jun','Hyun-soo','Hyun-woo','Jae-hyun','Ji-ho',
        'Ji-hoon','Jin-woo','Joon-ho','Jun-seo','Kang-min','Ki-hyun','Kyung-min','Min-ho','Min-jae','Min-jun',
        'Sang-hoon','Seo-jun','Seung-min','Seung-woo','Si-woo','Sung-jin','Sung-min','Tae-hyun','Tae-yang','Woo-jin',
        'Ye-jun','Yong-su','Young-ho','Young-jae',
      ],
      last: [
        'Ahn','Bae','Baek','Cha','Cho','Choi','Chung','Gu','Ha','Han',
        'Heo','Hong','Hwang','Im','Jang','Jeon','Joo','Jung','Kang','Kim',
        'Ko','Kwak','Kwon','Lee','Lim','Min','Moon','Nam','Noh','Oh',
        'Park','Ryu','Seo','Shin','Song','Woo','Yang','Yoo','Yoon',
      ],
    },
    taiwan: {
      first: [
        'Chia-hao','Cheng-wei','Chih-hao','Chin-lung','Ching-wei','Chun-hsien','Hao-yu','Hsin-chieh','Hung-wen','Jia-cheng',
        'Kai-wen','Kuan-yu','Kuo-hui','Li-wei','Ming-che','Ming-hsuan','Sheng-en','Shih-chieh','Ta-wei','Tzu-hao',
        'Wei-chieh','Wei-lun','Wen-hua','Yao-hsun','Yen-hsun','Yi-chuan','Yu-cheng','Yung-chi',
      ],
      last: [
        'Chang','Chen','Cheng','Chiang','Chiu','Chou','Chuang','Fan','Feng','Ho',
        'Hsiao','Hsieh','Hsu','Huang','Hung','Kao','Kuo','Lai','Lee','Li',
        'Liao','Lin','Liu','Lo','Lu','Pan','Peng','Shen','Su','Sun',
        'Tsai','Tseng','Tu','Wang','Wei','Wu','Yang','Yeh','Yen','Yu',
      ],
    },
    // Dutch Caribbean (Curaçao/Aruba): Papiamento/Dutch/Spanish blend.
    curacao: {
      first: [
        'Ardley','Delano','Dwight','Emilio','Genaro','Gregory','Hensley','Jair','Jandino','Jean-Carlos',
        'Jurdell','Marlon','Miguel','Orlando','Osvaldo','Quincy','Randolph','Raydel','Roald','Rocher',
        'Sherman','Shurendell','Sidney','Urvin','Wladimir','Xander','Yairo',
      ],
      last: [
        'Albertus','Antonia','Bernabela','Cijntje','Constancia','Daal','Elisa','Evertsz','Felicia','Isenia',
        'Janga','Jansen','Koeiman','Leito','Maduro','Martina','Martis','Mercelina','Paulina','Philippa',
        'Rosaria','Sluis','Statia','Tromp','Victoria','Winklaar',
      ],
    },
  };

  const COUNTRY_POOL = {
    'Dominican Republic': 'hispanic',
    'Venezuela': 'hispanic',
    'Cuba': 'hispanic',
    'Mexico': 'hispanic',
    'Puerto Rico': 'hispanic',
    'Colombia': 'hispanic',
    'Panama': 'hispanic',
    'Nicaragua': 'hispanic',
    'Japan': 'japan',
    'South Korea': 'korea',
    'Taiwan': 'taiwan',
    'Curaçao': 'curacao',
  };

  // Draw a { first, last } for the country, or null when the country has
  // no dedicated pool (caller keeps its default name).
  function nameFor(country, rng) {
    const key = COUNTRY_POOL[country];
    if (!key) return null;
    const pool = POOLS[key];
    const r = rng || Math.random;
    return {
      first: pool.first[Math.floor(r() * pool.first.length)],
      last: pool.last[Math.floor(r() * pool.last.length)],
    };
  }

  return { nameFor, POOLS, COUNTRY_POOL };
})();
