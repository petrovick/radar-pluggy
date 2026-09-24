# Revisão das dependências de segurança — 2026-09-23

`npm audit --omit=dev` informa dois avisos moderados para `sequelize@6.37.8` → `uuid@8.3.2`. O aviso [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) depende de `uuid.v3/v5/v6` com buffer e offset inválidos. Na cópia atual de Sequelize, as chamadas encontradas usam `uuid.v1/v4` sem buffer; não foi identificado caminho para a condição do aviso no uso atual.

O `npm audit fix --force` propõe `sequelize@3.30.0`, um downgrade incompatível. A versão 6.37.8 permanece até existir correção compatível ou migração planejada. O aviso transitivo continua visível no audit; reavaliar após atualização do ORM e rodar `npm audit --omit=dev` em cada alteração do lockfile.

O `qs` transitivo já resolve em 6.16.0 via override existente; não há aviso de `qs` na auditoria de produção.
