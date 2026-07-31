# Extract a Function

Pull lines {{line_range}} of {{file_path}} out into their own function. Behaviour stays identical - same
output, same side effects, same order.

Give me:

- A name for it, based on what the block is for rather than how it does it.
- The parameter list, with types, and what it returns.
- Any variable the block writes to that the code after it still reads.

That last one is the part I care about. If the block mutates something the caller depends on, say so
before you write the code, and tell me whether to return it or pass it in by reference.

Leave the call site looking the same shape as the code around it. If the block only makes sense with four
or more parameters, stop and tell me - the split is probably in the wrong place.
