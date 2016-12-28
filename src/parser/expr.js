/*!
 * Copyright (C) 2017 Glayzzle (BSD3 License)
 * @authors https://github.com/glayzzle/php-parser/graphs/contributors
 * @url http://glayzzle.com
 */

module.exports = {

  read_expr: function() {
    var expr = this.read_expr_item();
    switch(this.token) {
      // binary operations
      case '|': return this.node('bin')('|', expr, this.next().read_expr());
      case '&': return this.node('bin')('&', expr, this.next().read_expr());
      case '^': return ['bin', '^', expr, this.next().read_expr()];
      case '.': return ['bin', '.', expr, this.next().read_expr()];
      case '+': return ['bin', '+', expr, this.next().read_expr()];
      case '-': return ['bin', '-', expr, this.next().read_expr()];
      case '*': return ['bin', '*', expr, this.next().read_expr()];
      case '/': return ['bin', '/', expr, this.next().read_expr()];
      case '%': return ['bin', '%', expr, this.next().read_expr()];
      case this.tok.T_POW:  return ['bin', '**', expr, this.next().read_expr()];
      case this.tok.T_SL:   return ['bin', '<<', expr, this.next().read_expr()];
      case this.tok.T_SR:   return ['bin', '>>', expr, this.next().read_expr()];

      // boolean operations
      case this.tok.T_BOOLEAN_OR:
      case this.tok.T_LOGICAL_OR:   return ['bool', '|', expr, this.next().read_expr()];

      case this.tok.T_BOOLEAN_AND:
      case this.tok.T_LOGICAL_AND:  return ['bool', '&', expr, this.next().read_expr()];

      case this.tok.T_LOGICAL_XOR:      return ['bool', '^', expr, this.next().read_expr()];
      case this.tok.T_IS_IDENTICAL:     return ['bool', '=', expr, this.next().read_expr()];
      case this.tok.T_IS_NOT_IDENTICAL: return ['bool', '!=', expr, this.next().read_expr()];
      case this.tok.T_IS_EQUAL:         return ['bool', '~', expr, this.next().read_expr()];
      case this.tok.T_IS_NOT_EQUAL:     return ['bool', '!~', expr, this.next().read_expr()];
      case '<':                       return ['bool', '<', expr, this.next().read_expr()];
      case '>':                       return ['bool', '>', expr, this.next().read_expr()];

      case this.tok.T_IS_SMALLER_OR_EQUAL:  return ['bool', '<=', expr, this.next().read_expr()];
      case this.tok.T_IS_GREATER_OR_EQUAL:  return ['bool', '>=', expr, this.next().read_expr()];
      case this.tok.T_SPACESHIP:            return ['bool', '<=>', expr, this.next().read_expr()];
      case this.tok.T_INSTANCEOF:           return ['bool', '?', expr, this.next().read_expr()];

      // extra operations :
      case this.tok.T_COALESCE:
        // $username = $_GET['user'] ?? 'nobody';
        return this.node('coalesce')(
          expr, this.next().read_expr()
        );

      case '?':
        var trueArg = null;
        if (this.next().token !== ':') {
          trueArg = this.read_expr();
        }
        if (this.expect(':')) {
          this.next();
        }
        return ['retif', expr, trueArg, this.read_expr()];
    }
    return expr;
  }

  /**
   * ```ebnf
   * Reads an expression
   *  expr ::= @todo
   * ```
   */
  ,read_expr_item: function() {

    switch(this.token) {

      case '@':
        return ['silent', this.next().read_expr()];

      case '-':
        var result = this.node();
        this.next();
        if (
          this.token === this.tok.T_LNUMBER ||
          this.token === this.tok.T_DNUMBER
        ) {
          // negative number
          result = result('number', '-' + this.text());
          this.next();
          return result;
        } else {
          return result('unary', '-', this.read_expr());
        }

      case '+':
      case '!':
      case '~':
        return this.node('unary')(this.token, this.read_expr());

      case '(':
        var expr = this.next().read_expr();
        if (this.expect(')')) {
          this.next();
        }

        // handle dereferencable
        if (this.token === this.tok.T_OBJECT_OPERATOR) {
          return this.recursive_variable_chain_scan(expr, false);
        } else if (this.token === this.tok.T_CURLY_OPEN || this.token === '[') {
          return this.read_dereferencable(expr);
        } else if (this.token === '(') {
          // https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L1118
          return this.node('call')(
            expr, this.read_function_argument_list()
          );
        } else {
          return expr;
        }

      case '`':
        // https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L1048
        var result = this.node('shell');
        var expr = this.next().read_encapsed_string('`');
        return result(expr);

      case this.tok.T_LIST:
        var result = this.node('list'), assign = null;
        var isInner = this.innerList;
        if (!isInner) {
          assign = this.node('assign');
        }
        if (this.next().expect('(')) {
          this.next();
        }

        if (!this.innerList) this.innerList = true;
        var assignList = this.read_assignment_list();

        // check if contains at least one assignment statement
        var hasItem = false;
        for(var i = 0; i < assignList.length; i++) {
          if (assignList[i] !== null) {
            hasItem = true;
            break;
          }
        }
        if (!hasItem) {
          this.raiseError(
            'Fatal Error :  Cannot use empty list on line ' + this.lexer.yylloc.first_line
          );
        }
        if (this.expect(')')) {
          this.next();
        }

        if (!isInner) {
          this.innerList = false;
          if (this.expect('=')) {
            return assign(
              result(assignList),
              this.next().read_expr(),
              '='
            );
          } else {
            // fallback : list($a, $b);
            return result(assignList);
          }
        } else {
          return result(assignList);
        }

      case this.tok.T_CLONE:
        return this.node('clone')(
          this.next().read_expr()
        );

      case this.tok.T_INC:
        var name = this.next().read_variable(false, false, false);
        return ['set', name, ['bin', '+', name, ['number', 1]]];

      case this.tok.T_DEC:
        var name = this.next().read_variable(false, false, false);
        return ['set', name, ['bin', '-', name, ['number', 1]]];

      case this.tok.T_NEW:
        return this.next().read_new_expr();

      case this.tok.T_ISSET:
        var result = this.node('isset');
        if (this.next().expect('(')) {
          this.next();
        }
        var args = this.read_list(this.read_expr, ',');
        if (this.expect(')')) {
          this.next();
        }
        return result(args);

      case this.tok.T_EMPTY:
        var result = this.node('empty');
        if (this.next().expect('(')) {
          this.next();
        }
        var arg = this.read_expr();
        if (this.expect(')')) {
          this.next();
        }
        return result([arg]);

      case this.tok.T_INCLUDE:
        return this.node('include')(
          false, false,
          this.next().read_expr()
        );

      case this.tok.T_INCLUDE_ONCE:
        return this.node('include')(
          true, false,
          this.next().read_expr()
        );

      case this.tok.T_REQUIRE:
        return this.node('include')(
          false, true,
          this.next().read_expr()
        );

      case this.tok.T_REQUIRE_ONCE:
        return this.node('include')(
          true, true,
          this.next().read_expr()
        );

      case this.tok.T_EVAL:
        var result = this.node('eval');
        if (this.next().expect('(')) {
          this.next();
        }
        var expr = this.read_expr();
        if (this.expect(')')) {
          this.next();
        }
        return result(expr);

      case this.tok.T_INT_CAST:
        return ['cast', 'int', this.next().read_expr()];

      case this.tok.T_DOUBLE_CAST:
        return ['cast', 'double', this.next().read_expr()];

      case this.tok.T_STRING_CAST:
        return ['cast', 'string', this.next().read_expr()];

      case this.tok.T_ARRAY_CAST:
        return ['cast', 'array', this.next().read_expr()];

      case this.tok.T_OBJECT_CAST:
        return ['cast', 'object', this.next().read_expr()];

      case this.tok.T_BOOL_CAST:
        return ['cast', 'boolean', this.next().read_expr()];

      case this.tok.T_UNSET_CAST:
        return this.node('unset')(
          this.next().read_expr()
        );

      case this.tok.T_EXIT:
        var result = this.node('exit');
        var status = null;
        if ( this.next().token === '(' ) {
          if (this.next().token !== ')') {
            status = this.read_expr();
            if (this.expect(')')) {
              this.next();
            }
          } else {
            this.next();
          }
        }
        return result(status);

      case this.tok.T_PRINT:
        return this.node('print')(
          this.next().read_expr()
        );

      // T_YIELD (expr (T_DOUBLE_ARROW expr)?)?
      case this.tok.T_YIELD:
        var result = ['yield', null, null];
        if (this.next().is('EXPR')) {
          // reads the yield return value
          result[1] = this.read_expr();
          if (this.token === this.tok.T_DOUBLE_ARROW) {
            // reads the yield returned key
            result[2] = this.next().read_expr();
          }
        }
        return result;

      // T_YIELD_FROM expr
      case this.tok.T_YIELD_FROM:
        return ['yieldfrom', this.next().read_expr()];

      case this.tok.T_FUNCTION:
        // @fixme later - removed static lambda function declarations (colides with static keyword usage)
        return this.read_function(true);

    }

    // SCALAR | VARIABLE
    var expr;
    if (this.is('VARIABLE')) {
      expr = this.read_variable(false, false, false);
      // VARIABLES SPECIFIC OPERATIONS
      switch(this.token) {
        case '=':
          var result = this.node('assign');
          var right;
          if (this.next().token == '&') {
            if (this.next().token === this.tok.T_NEW) {
              right = this.next().read_new_expr();
            } else {
              right = this.read_variable(false, false, true);
            }
          } else {
            right = this.read_expr();
          }
          return result(expr, right, '=');

        // operations :
        case this.tok.T_PLUS_EQUAL:
          return ['set', expr, ['bin', '+', expr, this.next().read_expr()]];
        case this.tok.T_MINUS_EQUAL:
          return ['set', expr, ['bin', '-', expr, this.next().read_expr()]];
        case this.tok.T_MUL_EQUAL:
          return ['set', expr, ['bin', '*', expr, this.next().read_expr()]];
        case this.tok.T_POW_EQUAL:
          return ['set', expr, ['bin', '**', expr, this.next().read_expr()]];
        case this.tok.T_DIV_EQUAL:
          return ['set', expr, ['bin', '/', expr, this.next().read_expr()]];
        case this.tok.T_CONCAT_EQUAL:
          // NB : convert as string and add
          return ['set', expr, ['bin', '.', expr, this.next().read_expr()]];
        case this.tok.T_MOD_EQUAL:
          return ['set', expr, ['bin', '%', expr, this.next().read_expr()]];
        case this.tok.T_AND_EQUAL:
          return ['set', expr, ['bin', '&', expr, this.next().read_expr()]];
        case this.tok.T_OR_EQUAL:
          return ['set', expr, ['bin', '|', expr, this.next().read_expr()]];
        case this.tok.T_XOR_EQUAL:
          return ['set', expr, ['bin', '^', expr, this.next().read_expr()]];
        case this.tok.T_SL_EQUAL:
          return ['set', expr, ['bin', '<<', expr, this.next().read_expr()]];
        case this.tok.T_SR_EQUAL:
          return ['set', expr, ['bin', '>>', expr, this.next().read_expr()]];
        case this.tok.T_INC:
          var result = this.node('post');
          this.next();
          return result('+', expr);
        case this.tok.T_DEC:
          var result = this.node('post');
          this.next();
          return result('+', expr);
      }
    } else if (this.is('SCALAR')) {
      expr = this.read_scalar();
      // handle dereferencable
      while(this.token !== this.EOF) {
        if (this.token === this.tok.T_OBJECT_OPERATOR) {
          expr = this.recursive_variable_chain_scan(expr, false);
        } else if (this.token === this.tok.T_CURLY_OPEN || this.token === '[') {
          expr = this.read_dereferencable(expr);
        } else if (this.token === '(') {
          // https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L1118
          expr = this.node('call')(expr, this.read_function_argument_list());
        } else {
          return expr;
        }
      }
    } else {
      expr = this.error('EXPR');
      this.next();
    }

    // returns variable | scalar
    return expr;

  }
  /**
   * ```ebnf
   *    new_expr ::= T_NEW (namespace_name function_argument_list) | (T_CLASS ... class declaration)
   * ```
   * https://github.com/php/php-src/blob/master/Zend/zend_language_parser.y#L850
   */
  ,read_new_expr: function() {
    var result = this.node('new');
    if (this.token === this.tok.T_CLASS) {
      // Annonymous class declaration
      var propExtends = null, propImplements = null, body = null;
      if (this.next().token == this.tok.T_EXTENDS) {
        propExtends = this.next().read_namespace_name();
      }
      if (this.token == this.tok.T_IMPLEMENTS) {
        propImplements = this.next().read_name_list();
      }
      if (this.expect('{')) {
        body = this.next().read_class_body();
      }
      return result(
        false           // class name => false : means it's an annonymous class
        ,propExtends
        ,propImplements
        ,body
      );
    } else {
      // Already existing class
      var name = this.read_class_name_reference();
      var args = [];
      if (this.token === '(') {
        args = this.read_function_argument_list();
      }
      return result(name, args);
    }
  }
  /**
   * Reads a class name
   * ```ebnf
   * class_name_reference ::= namespace_name | variable
   * ```
   */
  ,read_class_name_reference: function() {
    if (this.token === '\\' || this.token === this.tok.T_STRING) {
      var result = this.read_namespace_name();
      if (this.token === this.tok.T_DOUBLE_COLON) {
        result = this.read_static_getter(result);
      } else {
        result = ['ns', result];
      }
      return result;
    } else if (this.is('VARIABLE')) {
      return this.read_variable(true, false, false);
    } else {
      this.expect([this.tok.T_STRING, 'VARIABLE']);
    }
  }
  /**
   * ```ebnf
   *   assignment_list ::= assignment_list_element (',' assignment_list_element?)*
   * ```
   */
  ,read_assignment_list: function() {
    return this.read_list(
      this.read_assignment_list_element, ','
    );
  }

  /**
   * ```ebnf
   *  assignment_list_element ::= expr | expr T_DOUBLE_ARROW expr
   * ```
   */
  ,read_assignment_list_element: function() {
    if (this.token === ',' || this.token === ')') return null;
    var result = this.read_expr_item();
    if (this.token === this.tok.T_DOUBLE_ARROW) {
      result = [
        'key',
        result,
        this.next().read_expr_item()
      ];
    }
    return result;
  }
};
